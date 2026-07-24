// lx-source-engine.js
// LX 音乐源兼容引擎 — VM 沙箱 + globalThis.lx + 源脚本生命周期管理
const vm = require('vm');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const tunnel = require('tunnel');

// Proxy configuration matching lx-music-desktop's preload.js getRequestAgent
// Only enabled when LX_PROXY_ENABLED=1 env var is set
var LX_PROXY_HOST = process.env.LX_PROXY_HOST || '127.0.0.1';
var LX_PROXY_PORT = parseInt(process.env.LX_PROXY_PORT || '10808', 10);
var LX_PROXY_ENABLED = process.env.LX_PROXY_ENABLED === '1';
function getRequestAgent(url) {
  if (!LX_PROXY_ENABLED || !LX_PROXY_HOST) return undefined;
  var isHttps = /^https:/i.test(url);
  try {
    if (isHttps) return tunnel.httpsOverHttp({ proxy: { host: LX_PROXY_HOST, port: LX_PROXY_PORT } });
    else return tunnel.httpOverHttp({ proxy: { host: LX_PROXY_HOST, port: LX_PROXY_PORT } });
  } catch(e) { return undefined; }
}

const SOURCES_DIR = path.join(__dirname, '.lx-sources');
const INDEX_FILE = path.join(SOURCES_DIR, 'index.json');
const STATE_FILE = path.join(SOURCES_DIR, 'state.json');

// ---------- storage ----------
function ensureDir() {
  if (!fs.existsSync(SOURCES_DIR)) fs.mkdirSync(SOURCES_DIR, { recursive: true });
}

function readIndex() {
  ensureDir();
  try { return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8')); } catch (e) { return []; }
}

function writeIndex(entries) {
  ensureDir();
  fs.writeFileSync(INDEX_FILE, JSON.stringify(entries, null, 2), 'utf8');
}

// ---------- JSDoc parser ----------
function parseScriptInfo(script) {
  var block = /\/\*!?\s*([\s\S]*?)\*\//.exec(script);
  var info = { name: 'unknown', description: '', version: '0.0.0', author: 'unknown' };
  if (!block || !block[1]) return info;
  var lines = block[1].split('\n');
  for (var i = 0; i < lines.length; i++) {
    var m = /^\s*\*?\s*@(\w+)\s+(.+)/.exec(lines[i]);
    if (!m) {
      // Try multi-line: @description on one line, value on next
      m = /^\s*\*?\s*@(\w+)\s*$/.exec(lines[i]);
      if (m && lines[i + 1]) {
        var descLine = lines[i + 1].replace(/^\s*\*?\s*/, '').trim();
        if (descLine && !descLine.startsWith('@')) {
          info[m[1]] = descLine.substring(0, 200);
        }
      }
      continue;
    }
    var key = m[1];
    var val = m[2].trim();
    if (key === 'name') info.name = val.substring(0, 48);
    else if (key === 'description') info.description = val.substring(0, 200);
    else if (key === 'version') info.version = val.substring(0, 36);
    else if (key === 'author') info.author = val.substring(0, 56);
  }
  return info;
}

// ---------- lx compatibility layer ----------
var lxStore = {
  handlers: {},
  sources: {},
  version: '2.0.0',
  env: 'desktop',
};

function createLxAPI() {
  return {
    EVENT_NAMES: { request: 'request', inited: 'inited', updateAlert: 'updateAlert' },
    version: lxStore.version,
    env: lxStore.env,
    currentScriptInfo: null,
    request: function lxRequest(url, options, callback) {
      if (typeof options === 'function') { callback = options; options = {}; }
      options = options || {};
      var method = (options.method || 'GET').toUpperCase();
      var parsed = new URL(url);
      var mod = parsed.protocol === 'https:' ? https : http;
      var reqHeaders = Object.assign({}, options.headers || {});
      // Add default User-Agent matching lx-music-desktop's needle behavior
      if (!reqHeaders['User-Agent'] && !reqHeaders['user-agent']) {
        reqHeaders['User-Agent'] = 'lx-music-desktop/' + lxStore.version;
      }
      var reqTimeout = options.timeout || 15000;
      var reqOptions = {
        method: method,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        headers: reqHeaders,
        agent: getRequestAgent(url),
      };
      var timedOut = false;
      // Explicit setTimeout-based timeout (more reliable than socket timeout alone)
      var timer = setTimeout(function() {
        if (!timedOut) {
          timedOut = true;
          req.destroy();
          callback(new Error('Request timeout after ' + reqTimeout + 'ms'));
        }
      }, reqTimeout);

      var req = mod.request(reqOptions, function(res) {
        // Handle redirect — needle follows automatically, we must do it manually
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          clearTimeout(timer);
          var redirectUrl = res.headers.location;
          if (!/^https?:\/\//i.test(redirectUrl)) {
            redirectUrl = parsed.protocol + '//' + parsed.host + redirectUrl;
          }
          lxRequest(redirectUrl, options, callback);
          return;
        }
        var chunks = [];
        res.on('data', function(c) { chunks.push(c); });
        res.on('end', function() {
          if (timedOut) return;
          clearTimeout(timer);
          // Matching needle behavior: always convert raw to string first, then try JSON parse
          var rawString = Buffer.concat(chunks).toString('utf8');
          var body = rawString;
          try {
            body = JSON.parse(rawString);
          } catch (e) {}
          callback(null, {
            statusCode: res.statusCode,
            headers: res.headers,
            body: body,
          });
        });
      });
      req.on('error', function(err) {
        if (!timedOut) { timedOut = true; clearTimeout(timer); callback(err); }
      });
      if (options.body) req.write(options.body);
      if (options.form) {
        var formData = new URLSearchParams(options.form).toString();
        req.setHeader('Content-Type', 'application/x-www-form-urlencoded');
        req.write(formData);
      }
      req.end();
      return function() { try { req.destroy(); } catch (e) {} };
    },
    on: function(eventName, handler) {
      if (!lxStore.handlers[eventName]) lxStore.handlers[eventName] = [];
      lxStore.handlers[eventName].push(handler);
      return Promise.resolve();
    },
    send: function(eventName, data) {
      if (eventName === 'inited' && data && data.sources) {
        lxStore.sources = data.sources;
        lxStore.inited = true;
      }
      return Promise.resolve();
    },
    utils: {
      crypto: {
        aesEncrypt: function(buffer, mode, key, iv) {
          var cipher = crypto.createCipheriv(mode, key, iv || '');
          return Buffer.concat([cipher.update(buffer), cipher.final()]);
        },
        rsaEncrypt: function(buffer, key) {
          buffer = Buffer.concat([Buffer.alloc(128 - buffer.length), buffer]);
          return crypto.publicEncrypt({ key: key, padding: crypto.constants.RSA_NO_PADDING }, buffer);
        },
        randomBytes: function(size) { return crypto.randomBytes(size); },
        md5: function(str) { return crypto.createHash('md5').update(str).digest('hex'); },
      },
      buffer: {
        from: function() { return Buffer.from.apply(Buffer, arguments); },
        bufToString: function(buf, format) { return Buffer.from(buf, 'binary').toString(format || 'utf8'); },
      },
      zlib: {
        inflate: function(buf) { return new Promise(function(resolve, reject) { zlib.inflate(buf, function(err, r) { err ? reject(err) : resolve(r); }); }); },
        deflate: function(data) { return new Promise(function(resolve, reject) { zlib.deflate(data, function(err, r) { err ? reject(err) : resolve(r); }); }); },
      },
    },
  };
}

// ---------- VM sandbox execution ----------
// Node.js 18 supports modern JS natively — no transpilation needed
function runScriptInVM(scriptContent, scriptInfo) {
  return new Promise(function(resolve, reject) {

    // Reset store for this execution
    lxStore.handlers = {};
    lxStore.sources = {};
    lxStore.inited = false;

    var lxAPI = createLxAPI();
    // Include rawScript & homepage — obfuscated sources (e.g. lx-dujia.js) need these
    scriptInfo.rawScript = scriptContent;
    scriptInfo.homepage = scriptInfo.homepage || '';
    lxAPI.currentScriptInfo = scriptInfo;

    // Catch unhandled rejections like lx-music-desktop preload.js does
    var onRejection = function(reason) {
      console.error('[lx-engine] Unhandled rejection in source:', (reason && reason.message) || reason);
    };
    var rejectionTimer = setTimeout(function() {
      process.removeListener('unhandledRejection', onRejection);
    }, 15000);

    var sandbox = {
      console: console,
      process: { on: function() {}, env: {} },
      setTimeout: setTimeout,
      clearTimeout: clearTimeout,
      setInterval: setInterval,
      clearInterval: clearInterval,
      Promise: Promise,
      Buffer: Buffer,
      URL: URL,
      Error: Error,
      Object: Object,
      Array: Array,
      String: String,
      Number: Number,
      Boolean: Boolean,
      JSON: JSON,
      Math: Math,
      Date: Date,
      RegExp: RegExp,
      parseInt: parseInt,
      parseFloat: parseFloat,
      isNaN: isNaN,
      encodeURIComponent: encodeURIComponent,
      decodeURIComponent: decodeURIComponent,
    };
    // lx on sandbox BEFORE createContext — so it's part of the global object
    // Browser globals (before createContext so they're part of the global)
    sandbox.atob = function(str) { return Buffer.from(String(str), 'base64').toString('binary'); };
    sandbox.btoa = function(str) { return Buffer.from(String(str), 'binary').toString('base64'); };
    sandbox.TextEncoder = TextEncoder;
    sandbox.TextDecoder = TextDecoder;
    sandbox.navigator = { userAgent: 'lx-music-desktop/' + lxStore.version, appName: 'Netscape', platform: 'Win32' };
    sandbox.location = { href: 'http://127.0.0.1/', protocol: 'http:', host: '127.0.0.1', hostname: '127.0.0.1' };
    sandbox.document = { createElement: function() { return { style: {}, appendChild: function(){} }; }, body: { appendChild: function(){} }, head: { appendChild: function(){} }, documentElement: {} };
    var nodeCrypto = crypto;
    sandbox.crypto = { getRandomValues: function(arr) { var buf = nodeCrypto.randomBytes(arr.length); for (var i=0;i<arr.length;i++) arr[i]=buf[i]; return arr; }, randomUUID: function() { return nodeCrypto.randomUUID(); }, subtle: {} };
    sandbox.lx = lxAPI;

    var ctx = vm.createContext(sandbox);
    ctx.globalThis = ctx;
    ctx.self = ctx;
    ctx.window = ctx;  // many obfuscated scripts access window.String etc.
    ctx.performance = { now: function() { return Date.now(); } };
    ctx.XMLHttpRequest = function() { this.open=function(){}; this.send=function(){}; this.setRequestHeader=function(){}; };
    // eval/Function for obfuscated code deobfuscation
    ctx.eval = function(code) { return vm.runInContext(code, ctx, { timeout: 5000 }); };
    ctx.Function = function() {
      var args = Array.prototype.slice.call(arguments);
      var body = args.pop() || '';
      var params = args.join(',');
      return vm.runInContext('(function(' + params + '){' + body + '})', ctx, { timeout: 5000 });
    };
    // Register unhandledRejection handler BEFORE running script (matching lx-music-desktop preload.js)
    process.on('unhandledRejection', onRejection);
    try {
      var script = new vm.Script(scriptContent, { filename: 'lx-source-script.js' });
      script.runInContext(ctx, { timeout: 10000 });

      // Give the script 500ms to call lx.send('inited', ...)
      var waited = 0;
      var iv = setInterval(function() {
        waited += 100;
        if (lxStore.inited) {
          clearInterval(iv);
          clearTimeout(rejectionTimer);
          process.removeListener('unhandledRejection', onRejection);
          resolve({ sources: lxStore.sources, api: lxAPI });
        } else if (waited >= 5000) {
          clearInterval(iv);
          clearTimeout(rejectionTimer);
          process.removeListener('unhandledRejection', onRejection);
          reject(new Error('Source script timed out without calling lx.send("inited")'));
        }
      }, 100);
    } catch (err) {
      clearTimeout(rejectionTimer);
      process.removeListener('unhandledRejection', onRejection);
      // If inited was called before the error, still resolve (matching lx-music-desktop behavior)
      if (lxStore.inited) {
        console.error('[lx-engine] Script error after init:', err.message);
        resolve({ sources: lxStore.sources, api: lxAPI });
      } else {
        reject(err);
      }
    }
  });
}

// ---------- source lifecycle ----------
var loadedSources = []; // { id, info, api, sources, originUrl, filename, scriptBody }

// Shared core: process script body (after fetch or local read) into a registered source
async function _processScript(body, originUrl) {
  // 1. Parse metadata
  var info = parseScriptInfo(body);

  // 2. Execute in VM
  var result = await runScriptInVM(body, info);
  if (!result.sources || !Object.keys(result.sources).length) {
    throw new Error('Source script declared no sources');
  }

  // 3. Generate ID
  var id = 'lx_src_' + Date.now();

  // 4. Save to disk
  ensureDir();
  var filename = sanitizeFilename(info.name + '-' + info.version) + '.js';
  fs.writeFileSync(path.join(SOURCES_DIR, filename), body, 'utf8');

  // 5. Update index
  var entries = readIndex();
  // Remove old entry with same name+version
  entries = entries.filter(function(e) { return !(e.name === info.name && e.version === info.version); });
  var entry = {
    id: id,
    name: info.name,
    version: info.version,
    author: info.author,
    description: info.description,
    originUrl: originUrl,
    filename: filename,
    sources: Object.keys(result.sources),
    actions: Object.values(result.sources).map(function(s) { return s.actions || []; }).flat().filter(function(v, i, a) { return a.indexOf(v) === i; }),
    qualitys: Object.fromEntries(Object.entries(result.sources).map(function(e) { return [e[0], e[1].qualitys || []]; })),
    importedAt: new Date().toISOString(),
  };
  entries.push(entry);
  writeIndex(entries);

  // 6. Add to loaded sources (store scriptBody for later reload on source switch)
  loadedSources.push({ id: id, info: info, api: result.api, sources: result.sources, originUrl: originUrl, filename: filename, scriptBody: body });

  return entry;
}

async function importSource(originUrl) {
  // 1. Fetch script
  var body = await new Promise(function(resolve, reject) {
    var parsed = new URL(originUrl);
    var mod = parsed.protocol === 'https:' ? https : http;
    mod.get(originUrl, { timeout: 20000 }, function(res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return importSource(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() { resolve(Buffer.concat(chunks).toString('utf8')); });
    }).on('error', reject);
  });

  if (body.length > 9 * 1024 * 1024) throw new Error('Script too large (>9MB)');
  return _processScript(body, originUrl);
}

// Import from local file path
async function importLocalFile(filePath) {
  var absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) throw new Error('File not found: ' + absPath);
  var body = fs.readFileSync(absPath, 'utf8');
  if (body.length > 9 * 1024 * 1024) throw new Error('Script too large (>9MB)');
  return _processScript(body, 'file://' + absPath);
}

// Re-activate a source by re-running its script to refresh lxStore.handlers
function _reloadActiveSource() {
  var active = getActiveSource();
  if (!active || !active.scriptBody) return Promise.resolve();
  // Reset the shared store for this source's fresh run
  lxStore.handlers = {};
  lxStore.sources = {};
  lxStore.inited = false;
  return runScriptInVM(active.scriptBody, active.info).then(function(result) {
    active.api = result.api;
    active.sources = result.sources;
    console.log('[lx-engine] Reloaded active source:', active.info.name);
  }).catch(function(err) {
    console.error('[lx-engine] Failed to reload active source:', err.message);
  });
}

function loadAllSources() {
  var entries = readIndex();
  var promises = entries.map(function(entry) {
    return new Promise(function(resolve) {
      var filePath = path.join(SOURCES_DIR, entry.filename);
      if (!fs.existsSync(filePath)) {
        return resolve(null);
      }
      try {
        var body = fs.readFileSync(filePath, 'utf8');
        runScriptInVM(body, { name: entry.name, version: entry.version })
          .then(function(result) {
            loadedSources.push({ id: entry.id, info: { name: entry.name, version: entry.version }, api: result.api, sources: result.sources, originUrl: entry.originUrl, filename: entry.filename, scriptBody: body });
            resolve(entry);
          })
          .catch(function(err) {
            console.error('[lx-engine] Failed to load source ' + entry.name + ': ' + err.message);
            resolve(null);
          });
      } catch (e) {
        console.error('[lx-engine] Error loading ' + entry.filename + ': ' + e.message);
        resolve(null);
      }
    });
  });
  return Promise.all(promises).then(function(results) {
    var validIds = results.filter(Boolean).map(function(r) { return r.id; });
    var cleaned = entries.filter(function(e) { return validIds.indexOf(e.id) !== -1; });
    if (cleaned.length !== entries.length) writeIndex(cleaned);
    // Restore previous state
    try {
      if (fs.existsSync(STATE_FILE)) {
        var state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        if (state.enabled) {
          lxEnabled = true;
          // Verify the saved activeId still exists
          var stillExists = loadedSources.some(function(ls) { return ls.id === state.activeId; });
          activeSourceId = stillExists ? state.activeId : (loadedSources.length > 0 ? loadedSources[0].id : null);
          if (!stillExists && activeSourceId) {
            try { fs.writeFileSync(STATE_FILE, JSON.stringify({ enabled: lxEnabled, activeId: activeSourceId }), 'utf8'); } catch (e) {}
          }
          // Reload the active source to register its handlers (wait for completion)
          if (activeSourceId) {
            return _reloadActiveSource().then(function() { return cleaned; }).catch(function(err) {
              console.error('[lx-engine] Init reload error:', err.message);
              return cleaned;
            });
          }
        }
      }
    } catch (e) { console.error('[lx-engine] Failed to restore state:', e.message); }
    return cleaned;
  });
}

function getSources() {
  var entries = readIndex();
  return entries.map(function(entry) {
    var loaded = loadedSources.find(function(ls) { return ls.id === entry.id; });
    return {
      id: entry.id,
      name: entry.name,
      version: entry.version,
      author: entry.author,
      description: entry.description,
      originUrl: entry.originUrl,
      sources: entry.sources,
      actions: entry.actions,
      qualitys: entry.qualitys,
      importedAt: entry.importedAt,
      loaded: !!loaded,
    };
  });
}

var activeSourceId = null;
var lxEnabled = false;

// Synchronously restore LX state from disk at module load time.
// This must happen before server.listen() so that /api/lx/status
// returns the correct state immediately, preventing updateLxUI()
// from incorrectly overwriting the user's saved preference on
// cold start (especially Android where the race condition is tight).
try {
  if (fs.existsSync(STATE_FILE)) {
    var _initState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    lxEnabled = !!_initState.enabled;
    activeSourceId = _initState.activeId || null;
  }
} catch (e) {}

function setActiveSource(id, enabled) {
  var switched = false;
  if (id !== undefined && id !== activeSourceId) { activeSourceId = id; switched = true; }
  if (enabled !== undefined) lxEnabled = !!enabled;
  if (lxEnabled && !activeSourceId && loadedSources.length > 0) {
    activeSourceId = loadedSources[0].id;
  }
  // When switching active source or enabling LX, reload to register correct handlers
  if (lxEnabled && activeSourceId && (switched || enabled)) {
    _reloadActiveSource().catch(function(err) {
      console.error('[lx-engine] Reload on switch error:', err.message);
    });
  }
  // Persist state
  try {
    ensureDir();
    fs.writeFileSync(STATE_FILE, JSON.stringify({ enabled: lxEnabled, activeId: activeSourceId }), 'utf8');
  } catch (e) {}
}

function getActiveSource() {
  if (!lxEnabled || !activeSourceId) return null;
  return loadedSources.find(function(ls) { return ls.id === activeSourceId; }) || null;
}

function getStatus() {
  var active = getActiveSource();
  return {
    enabled: lxEnabled,
    activeId: activeSourceId,
    activeName: active ? active.info.name : null,
    sourceCount: loadedSources.length,
    sources: getSources(),
  };
}

function handleAction(action, source, info) {
  return new Promise(function(resolve, reject) {
    var settled = false;
    // Hard timeout: always reject after 20s regardless of internal state
    var hardTimer = setTimeout(function() {
      if (!settled) { settled = true; reject(new Error('Source script request timed out (hard timeout)')); }
    }, 20000);

    function safeResolve(data) { if (!settled) { settled = true; clearTimeout(hardTimer); resolve(data); } }
    function safeReject(err) { if (!settled) { settled = true; clearTimeout(hardTimer); reject(err); } }

    var active = getActiveSource();
    if (!active) return safeReject(new Error('No active LX source'));
    if (!active.sources[source]) return safeReject(new Error('Source "' + source + '" not supported by active script'));
    if (!active.sources[source].actions || active.sources[source].actions.indexOf(action) === -1) {
      return safeReject(new Error('Action "' + action + '" not supported for source "' + source + '"'));
    }

    // If no handler registered, try reloading the active source first (race recovery)
    if (!lxStore.handlers['request'] || !lxStore.handlers['request'].length) {
      console.log('[lx-engine] No handler registered, reloading active source...');
      _reloadActiveSource().then(function() {
        doHandle(action, source, info, safeResolve, safeReject);
      }).catch(function(err) {
        safeReject(new Error('Failed to reload source: ' + err.message));
      });
      return;
    }

    doHandle(action, source, info, safeResolve, safeReject);
  });
}

function doHandle(action, source, info, resolve, reject) {
    var handlers = lxStore.handlers['request'];
    if (!handlers || !handlers.length) return reject(new Error('No request handler registered in source script'));

    var handled = false;
    var timeout = setTimeout(function() {
      if (!handled) { handled = true; reject(new Error('Source script request timed out')); }
    }, 15000);

    try {
      var result = handlers[0]({ action: action, source: source, info: info });
      if (result && typeof result.then === 'function') {
        result.then(function(data) {
          if (!handled) { handled = true; clearTimeout(timeout); resolve(data); }
        }).catch(function(err) {
          if (!handled) { handled = true; clearTimeout(timeout); reject(err); }
        });
      } else {
        if (!handled) { handled = true; clearTimeout(timeout); resolve(result); }
      }
    } catch (err) {
      if (!handled) { handled = true; clearTimeout(timeout); reject(err); }
    }
}

async function removeSource(id) {
  var entries = readIndex();
  var entry = entries.find(function(e) { return e.id === id; });
  if (!entry) throw new Error('Source not found');
  if (entry.filename) {
    var fp = path.join(SOURCES_DIR, entry.filename);
    try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (e) {}
  }
  entries = entries.filter(function(e) { return e.id !== id; });
  writeIndex(entries);
  loadedSources = loadedSources.filter(function(ls) { return ls.id !== id; });
  if (activeSourceId === id) {
    activeSourceId = loadedSources.length > 0 ? loadedSources[0].id : null;
  }
}

async function refreshSource(id) {
  var entries = readIndex();
  var entry = entries.find(function(e) { return e.id === id; });
  if (!entry) throw new Error('Source not found');
  loadedSources = loadedSources.filter(function(ls) { return ls.id !== id; });
  return importSource(entry.originUrl);
}

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9一-鿿._-]/g, '_').substring(0, 120);
}

module.exports = {
  importSource: importSource,
  importLocalFile: importLocalFile,
  loadAllSources: loadAllSources,
  getSources: getSources,
  setActiveSource: setActiveSource,
  getActiveSource: getActiveSource,
  getStatus: getStatus,
  handleAction: handleAction,
  removeSource: removeSource,
  refreshSource: refreshSource,
};
