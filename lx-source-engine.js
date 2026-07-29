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
      var MAX_RETRIES = 3;
      var attempt = 0;
      var currentCancel = null;
      var cancelled = false;

      function _shouldRetry(err, statusCode) {
        if (statusCode === 429) return 2000 + Math.floor(Math.random() * 4000);
        if (statusCode && statusCode >= 400 && statusCode < 500) return -1; // 4xx non-429
        if (err) {
          var msg = (err.message || '').toLowerCase();
          if (msg.indexOf('etimedout') >= 0 || msg.indexOf('econnreset') >= 0 ||
              msg.indexOf('enotfound') >= 0 || msg.indexOf('socket hang up') >= 0 ||
              msg.indexOf('timeout') >= 0) return 0; // exponential backoff per attempt
        }
        if (statusCode && statusCode >= 500) return 0;
        return -1;
      }

      function _singleRequest(innerUrl, innerOptions, innerCallback) {
        var method = (innerOptions.method || 'GET').toUpperCase();
        var parsed = new URL(innerUrl);
        var mod = parsed.protocol === 'https:' ? https : http;
        var reqHeaders = Object.assign({}, innerOptions.headers || {});
        if (!reqHeaders['User-Agent'] && !reqHeaders['user-agent']) {
          reqHeaders['User-Agent'] = 'lx-music-desktop/' + lxStore.version;
        }
        var reqTimeout = innerOptions.timeout || 12000;
        var reqOptions = {
          method: method,
          hostname: parsed.hostname,
          port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
          path: parsed.pathname + parsed.search,
          headers: reqHeaders,
          agent: getRequestAgent(innerUrl),
        };
        var timedOut = false;
        var timer = setTimeout(function() {
          if (!timedOut) {
            timedOut = true;
            req.destroy();
            innerCallback(new Error('Request timeout after ' + reqTimeout + 'ms'));
          }
        }, reqTimeout);

        var req = mod.request(reqOptions, function(res) {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            clearTimeout(timer);
            var redirectUrl = res.headers.location;
            if (!/^https?:\/\//i.test(redirectUrl)) {
              redirectUrl = parsed.protocol + '//' + parsed.host + redirectUrl;
            }
            _singleRequest(redirectUrl, innerOptions, innerCallback);
            return;
          }
          var chunks = [];
          res.on('data', function(c) { chunks.push(c); });
          res.on('end', function() {
            if (timedOut) return;
            clearTimeout(timer);
            var rawString = Buffer.concat(chunks).toString('utf8');
            var body = rawString;
            try { body = JSON.parse(rawString); } catch (e) {}
            innerCallback(null, {
              statusCode: res.statusCode,
              headers: res.headers,
              body: body,
            });
          });
        });
        req.on('error', function(err) {
          if (!timedOut) { timedOut = true; clearTimeout(timer); innerCallback(err); }
        });
        if (innerOptions.body) req.write(innerOptions.body);
        if (innerOptions.form) {
          var formData = new URLSearchParams(innerOptions.form).toString();
          req.setHeader('Content-Type', 'application/x-www-form-urlencoded');
          req.write(formData);
        }
        req.end();
        return function() { try { req.destroy(); } catch (e) {} };
      }

      function _doAttempt() {
        if (cancelled) return;
        currentCancel = _singleRequest(url, options, function(err, res) {
          if (cancelled) return;
          if (err || (res && res.statusCode >= 400)) {
            var retryDelay = _shouldRetry(err, res ? res.statusCode : 0);
            if (retryDelay >= 0 && attempt < MAX_RETRIES) {
              attempt++;
              var delay = retryDelay > 0 ? retryDelay : Math.min(1000 * Math.pow(2, attempt - 1), 10000);
              setTimeout(_doAttempt, delay);
              return;
            }
          }
          callback(err, res);
        });
      }

      _doAttempt();
      return function() { cancelled = true; if (currentCancel) currentCancel(); };
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

// ============================================================
// Generic CacheStore — persistent JSON + memory with TTL, LRU eviction,
// failCount pollution protection, and dynamic configuration.
// ============================================================
function createCacheStore(opts) {
  opts = opts || {};
  var store = {
    name: opts.name || 'cache',
    maxEntries: opts.maxEntries || 300,
    ttl: opts.ttl || 1800000,
    filePath: opts.filePath || null,
    entries: {},    // key → { value, ts, failCount }
    dirty: false,
    persistTimer: null,
  };

  // Load from file if specified
  if (store.filePath) {
    loadCacheStore(store);
  }

  function _scheduleFlush() {
    if (!store.filePath) return;
    store.dirty = true;
    if (store.persistTimer) clearTimeout(store.persistTimer);
    store.persistTimer = setTimeout(function() { flushCacheStore(store); }, 5000);
  }

  function _evictOldest() {
    var keys = Object.keys(store.entries);
    if (keys.length >= store.maxEntries) {
      var oldest = null, oldestKey = null;
      for (var i = 0; i < keys.length; i++) {
        var e = store.entries[keys[i]];
        if (!oldest || e.ts < oldest) { oldest = e.ts; oldestKey = keys[i]; }
      }
      if (oldestKey) delete store.entries[oldestKey];
    }
  }

  function _validateEntry(entry) {
    if (!entry) return false;
    var age = Date.now() - entry.ts;
    if (age > store.ttl) return false;          // expired
    if (entry.failCount >= 3) return false;      // too many failures (pollution protection)
    return true;
  }

  return {
    get: function(key) {
      var entry = store.entries[key];
      if (!_validateEntry(entry)) {
        if (entry) delete store.entries[key];
        return null;
      }
      return entry.value;
    },

    set: function(key, value) {
      var existing = store.entries[key];
      var prevFail = existing ? existing.failCount : 0;
      _evictOldest();
      store.entries[key] = { value: value, ts: Date.now(), failCount: prevFail };
      _scheduleFlush();
    },

    markFailed: function(key) {
      var entry = store.entries[key];
      if (entry) {
        entry.failCount = (entry.failCount || 0) + 1;
        if (entry.failCount >= 3) {
          delete store.entries[key];
          _scheduleFlush();
          return true; // evicted
        }
        _scheduleFlush();
      }
      return false;
    },

    delete: function(key) {
      if (store.entries[key]) {
        delete store.entries[key];
        _scheduleFlush();
      }
    },

    clear: function() {
      store.entries = {};
      store.dirty = true;
      if (store.filePath) flushCacheStore(store);
    },

    stats: function() {
      var count = 0, failed = 0;
      var keys = Object.keys(store.entries);
      for (var i = 0; i < keys.length; i++) {
        var e = store.entries[keys[i]];
        if (_validateEntry(e)) { count++; if (e.failCount > 0) failed++; }
        else delete store.entries[keys[i]];
      }
      return { name: store.name, count: count, max: store.maxEntries, failed: failed };
    },

    updateConfig: function(config) {
      if (config.maxEntries != null) {
        store.maxEntries = config.maxEntries;
        // Evict excess entries
        var keys = Object.keys(store.entries);
        while (keys.length > store.maxEntries) {
          _evictOldest();
          keys = Object.keys(store.entries);
        }
      }
      if (config.ttl != null) store.ttl = config.ttl;
      _scheduleFlush();
    },

    getConfig: function() {
      return { name: store.name, maxEntries: store.maxEntries, ttl: store.ttl, persistent: !!store.filePath };
    },

    flush: function() {
      if (store.filePath) flushCacheStore(store);
    },
  };
}

function loadCacheStore(store) {
  try {
    if (fs.existsSync(store.filePath)) {
      var raw = fs.readFileSync(store.filePath, 'utf8');
      store.entries = JSON.parse(raw);
      if (!store.entries || typeof store.entries !== 'object') store.entries = {};
    }
  } catch (e) {
    console.error('[lx-engine] Failed to load ' + store.name + ' cache:', e.message);
    store.entries = {};
  }
}

function flushCacheStore(store) {
  if (!store.filePath) return;
  try {
    var tmp = store.filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(store.entries, null, 2), 'utf8');
    fs.renameSync(tmp, store.filePath);
    store.dirty = false;
  } catch (e) {
    console.error('[lx-engine] Failed to persist ' + store.name + ' cache:', e.message);
  }
}

// Validates that a lyric string contains at least one timestamp tag like [01:23.45]
// Missing timestamps = garbage data that should be evicted.
var LYRIC_TIMESTAMP_RE = /\[\d{1,2}:.*\d{1,4}\]/;

// ============================================================
// Cache instances
// ============================================================
var CACHE_DIR = SOURCES_DIR;

var musicUrlCache = createCacheStore({
  name: 'url', maxEntries: 300, ttl: 30 * 60 * 1000,
  filePath: path.join(CACHE_DIR, 'url_cache.json'),
});

var lyricCache = createCacheStore({
  name: 'lyric', maxEntries: 500, ttl: 7 * 24 * 60 * 60 * 1000,
  filePath: path.join(CACHE_DIR, 'lyric_cache.json'),
});

var crossSourceCache = createCacheStore({
  name: 'cross', maxEntries: 150, ttl: 60 * 60 * 1000,
  // memory-only (no filePath)
});

// Default config
var cacheConfig = {
  urlMax: 300, urlTtlMinutes: 30,
  lyricMax: 500, lyricTtlDays: 7,
  crossMax: 150, crossTtlMinutes: 60,
};

// Load config overrides from state file
(function _loadCacheConfig() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      var state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      if (state && state.cacheConfig) Object.assign(cacheConfig, state.cacheConfig);
    }
  } catch (e) {}
  // Apply loaded config
  musicUrlCache.updateConfig({ maxEntries: cacheConfig.urlMax, ttl: cacheConfig.urlTtlMinutes * 60 * 1000 });
  lyricCache.updateConfig({ maxEntries: cacheConfig.lyricMax, ttl: cacheConfig.lyricTtlDays * 24 * 60 * 60 * 1000 });
  crossSourceCache.updateConfig({ maxEntries: cacheConfig.crossMax, ttl: cacheConfig.crossTtlMinutes * 60 * 1000 });
})();

function _saveCacheConfig() {
  try {
    var state = {};
    if (fs.existsSync(STATE_FILE)) {
      try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) {}
    }
    state.cacheConfig = cacheConfig;
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (e) {
    console.error('[lx-engine] Failed to save cache config:', e.message);
  }
}

function _cacheKey(source, songId, type) {
  return source + ':' + songId + ':' + (type || 'default');
}

function handleAction(action, source, info) {
  return new Promise(function(resolve, reject) {
    var settled = false;
    // Hard timeout: always reject after 12s regardless of internal state
    var hardTimer = setTimeout(function() {
      if (!settled) { settled = true; reject(new Error('Source script request timed out (hard timeout)')); }
    }, 12000);

    function safeResolve(data) { if (!settled) { settled = true; clearTimeout(hardTimer); resolve(data); } }
    function safeReject(err) { if (!settled) { settled = true; clearTimeout(hardTimer); reject(err); } }

    // Check musicUrl cache (skip if info requests a refresh)
    if (action === 'musicUrl' && !(info && info.isRefresh)) {
      var cacheKey = _cacheKey(source, (info && info.musicInfo && info.musicInfo.songmid) || '', (info && info.type) || '');
      var cached = cacheKey ? musicUrlCache.get(cacheKey) : null;
      if (cached) {
        // Validate cached URL looks like an HTTP URL
        if (typeof cached === 'string' && /^https?:\/\//i.test(cached)) {
          console.log('[lx-engine] musicUrl cache hit:', cacheKey);
          return safeResolve(cached);
        }
        // Invalid cached data → evict
        musicUrlCache.delete(cacheKey);
      }
    }

    var active = getActiveSource();
    if (!active) return safeReject(new Error('No active LX source'));
    if (!active.sources[source]) return safeReject(new Error('Source "' + source + '" not supported by active script'));
    if (!active.sources[source].actions || active.sources[source].actions.indexOf(action) === -1) {
      return safeReject(new Error('Action "' + action + '" not supported for source "' + source + '"'));
    }

    if (!lxStore.handlers['request'] || !lxStore.handlers['request'].length) {
      console.log('[lx-engine] No handler registered, reloading active source...');
      _reloadActiveSource().then(function() {
        doHandleAndCache(action, source, info, safeResolve, safeReject);
      }).catch(function(err) {
        safeReject(new Error('Failed to reload source: ' + err.message));
      });
      return;
    }

    doHandleAndCache(action, source, info, safeResolve, safeReject);
  });
}

function doHandleAndCache(action, source, info, resolve, reject) {
  var origResolve = function(data) {
    // Cache successful musicUrl results
    if (action === 'musicUrl' && data && !(info && info.isRefresh)) {
      var cacheKey = _cacheKey(source, (info && info.musicInfo && info.musicInfo.songmid) || '', (info && info.type) || '');
      if (cacheKey && typeof data === 'string' && /^https?:\/\//i.test(data)) {
        musicUrlCache.set(cacheKey, data);
      }
    }
    // If isRefresh=true and old URL was bad, increment failCount on old key
    if (action === 'musicUrl' && info && info.isRefresh) {
      var oldKey = _cacheKey(source, (info && info.musicInfo && info.musicInfo.songmid) || '', (info && info.type) || '');
      if (oldKey) musicUrlCache.markFailed(oldKey);
    }
    resolve(data);
  };
  doHandle(action, source, info, origResolve, reject);
}

function doHandle(action, source, info, resolve, reject) {
    var handlers = lxStore.handlers['request'];
    if (!handlers || !handlers.length) return reject(new Error('No request handler registered in source script'));

    var handled = false;
    var timeout = setTimeout(function() {
      if (!handled) { handled = true; reject(new Error('Source script request timed out')); }
    }, 10000);

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
  // Cache management
  getCacheStats: function() {
    return {
      url: musicUrlCache.stats(),
      lyric: lyricCache.stats(),
      crossSource: crossSourceCache.stats(),
    };
  },
  clearCache: function(type) {
    var cleared = 0;
    if (type === 'url' || type === 'all') {
      cleared += musicUrlCache.stats().count;
      musicUrlCache.clear();
    }
    if (type === 'lyric' || type === 'all') {
      cleared += lyricCache.stats().count;
      lyricCache.clear();
    }
    if (type === 'crossSource' || type === 'all') {
      cleared += crossSourceCache.stats().count;
      crossSourceCache.clear();
    }
    return cleared;
  },
  getCacheConfig: function() {
    return {
      urlMax: cacheConfig.urlMax,
      urlTtlMinutes: cacheConfig.urlTtlMinutes,
      lyricMax: cacheConfig.lyricMax,
      lyricTtlDays: cacheConfig.lyricTtlDays,
      crossMax: cacheConfig.crossMax,
      crossTtlMinutes: cacheConfig.crossTtlMinutes,
    };
  },
  updateCacheConfig: function(newConfig) {
    if (newConfig.urlMax != null) cacheConfig.urlMax = newConfig.urlMax;
    if (newConfig.urlTtlMinutes != null) cacheConfig.urlTtlMinutes = newConfig.urlTtlMinutes;
    if (newConfig.lyricMax != null) cacheConfig.lyricMax = newConfig.lyricMax;
    if (newConfig.lyricTtlDays != null) cacheConfig.lyricTtlDays = newConfig.lyricTtlDays;
    if (newConfig.crossMax != null) cacheConfig.crossMax = newConfig.crossMax;
    if (newConfig.crossTtlMinutes != null) cacheConfig.crossTtlMinutes = newConfig.crossTtlMinutes;
    musicUrlCache.updateConfig({ maxEntries: cacheConfig.urlMax, ttl: cacheConfig.urlTtlMinutes * 60 * 1000 });
    lyricCache.updateConfig({ maxEntries: cacheConfig.lyricMax, ttl: cacheConfig.lyricTtlDays * 24 * 60 * 60 * 1000 });
    crossSourceCache.updateConfig({ maxEntries: cacheConfig.crossMax, ttl: cacheConfig.crossTtlMinutes * 60 * 1000 });
    _saveCacheConfig();
    return true;
  },
  // Public cache keys for use by server.js when proxying lyrics
  getCachedLyric: function(source, songId) {
    return lyricCache.get(source + ':' + songId + ':lyric');
  },
  setCachedLyric: function(source, songId, lyricText) {
    if (lyricText && LYRIC_TIMESTAMP_RE.test(lyricText)) {
      lyricCache.set(source + ':' + songId + ':lyric', lyricText);
    }
  },
  getCachedCrossSource: function(source, songId) {
    return crossSourceCache.get(source + ':' + songId + ':cross');
  },
  setCachedCrossSource: function(source, songId, data) {
    crossSourceCache.set(source + ':' + songId + ':cross', data);
  },
};
