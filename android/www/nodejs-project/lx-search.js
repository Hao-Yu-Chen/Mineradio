// lx-search.js
// LX 模式搜索实现 — 按 lx-music-desktop built-in SDK 方式调用各平台 API
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const tunnel = require('tunnel');

// Proxy configuration (matching lx-source-engine.js)
var LX_PROXY_HOST = process.env.LX_PROXY_HOST || '127.0.0.1';
var LX_PROXY_PORT = parseInt(process.env.LX_PROXY_PORT || '10808', 10);
var LX_PROXY_ENABLED = process.env.LX_PROXY_ENABLED === '1';
function getRequestAgent(requestUrl) {
  if (!LX_PROXY_ENABLED) return undefined;
  if (/^https:/i.test(requestUrl)) {
    try { return tunnel.httpsOverHttp({ proxy: { host: LX_PROXY_HOST, port: LX_PROXY_PORT } }); } catch(e) {}
  } else {
    try { return tunnel.httpOverHttp({ proxy: { host: LX_PROXY_HOST, port: LX_PROXY_PORT } }); } catch(e) {}
  }
  return undefined;
}

function _isRetryableHttpError(err, statusCode) {
  if (statusCode === 429) return true;
  if (statusCode && statusCode >= 400 && statusCode < 500) return false; // 4xx non-429
  if (err) {
    var msg = (err.message || '').toLowerCase();
    if (msg.indexOf('etimedout') >= 0 || msg.indexOf('econnreset') >= 0 ||
        msg.indexOf('enotfound') >= 0 || msg.indexOf('socket hang up') >= 0 ||
        msg.indexOf('timeout') >= 0) return true;
  }
  if (statusCode && statusCode >= 500) return true;
  return false;
}

function _httpWithRetry(fn, args, maxRetries) {
  maxRetries = maxRetries || 3;
  var attempt = 0;
  function _try() {
    return fn.apply(null, args).catch(function(err) {
      var statusCode = err && err.statusCode ? err.statusCode : 0;
      if (attempt < maxRetries && _isRetryableHttpError(err, statusCode)) {
        attempt++;
        var delay = statusCode === 429
          ? 2000 + Math.floor(Math.random() * 4000)
          : Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        return new Promise(function(resolve) { setTimeout(resolve, delay); }).then(_try);
      }
      throw err;
    });
  }
  return _try();
}

function _httpGetRaw(url, timeout) {
  return new Promise(function(resolve, reject) {
    var mod = url.startsWith('https:') ? https : http;
    var opts = { timeout: timeout || 10000, agent: getRequestAgent(url) };
    var req = mod.get(url, opts, function(res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return _httpGetRaw(res.headers.location, timeout).then(resolve).catch(reject);
      }
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { resolve(null); }
      });
    });
    req.on('error', function(err) { reject(err); });
  });
}

function _httpPostRaw(url, body, headers, timeout) {
  return new Promise(function(resolve, reject) {
    var mod = url.startsWith('https:') ? https : http;
    var hdrs = Object.assign({}, headers || {}, { 'Content-Length': Buffer.byteLength(body || '') });
    var req = mod.request(url, { method: 'POST', headers: hdrs, timeout: timeout || 10000, agent: getRequestAgent(url) }, function(res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return _httpPostRaw(res.headers.location, body, headers, timeout).then(resolve).catch(reject);
      }
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { resolve(null); }
      });
    });
    req.on('error', function(err) { reject(err); });
    if (body) req.write(body);
    req.end();
  });
}

function _httpPostBufferRaw(url, body, headers, timeout) {
  return new Promise(function(resolve, reject) {
    var mod = url.startsWith('https:') ? https : http;
    var hdrs = Object.assign({}, headers || {}, { 'Content-Length': Buffer.byteLength(body || '') });
    var req = mod.request(url, { method: 'POST', headers: hdrs, timeout: timeout || 10000, agent: getRequestAgent(url) }, function(res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return _httpPostBufferRaw(res.headers.location, body, headers, timeout).then(resolve).catch(reject);
      }
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() { resolve(Buffer.concat(chunks)); });
    });
    req.on('error', function(err) { reject(err); });
    if (body) req.write(body);
    req.end();
  });
}

// Retry-wrapped public functions — match lx-music-desktop's 3-retry behavior
function httpGet(url, timeout) {
  return _httpWithRetry(_httpGetRaw, [url, timeout]);
}
function httpPost(url, body, headers, timeout) {
  return _httpWithRetry(_httpPostRaw, [url, body, headers, timeout]);
}
function httpPostRaw(url, body, headers, timeout) {
  return _httpWithRetry(_httpPostBufferRaw, [url, body, headers, timeout]);
}

function decodeHTMLEntities(str) {
  if (!str) return '';
  return String(str).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
}

function formatTime(seconds) {
  var s = Math.floor(seconds || 0);
  var m = Math.floor(s / 60);
  s = s % 60;
  return m + ':' + (s < 10 ? '0' : '') + s;
}

function sizeFormate(size) {
  if (!size || size <= 0) return null;
  if (size < 1024) return size + 'B';
  if (size < 1048576) return (size / 1024).toFixed(2) + 'K';
  return (size / 1048576).toFixed(2) + 'M';
}

// ======================== kw (酷我) search ========================
async function searchKW(keyword, limit) {
  limit = limit || 20;
  var kw = encodeURIComponent(keyword);
  var url = 'http://search.kuwo.cn/r.s?client=kt&all=' + kw + '&pn=0&rn=' + limit +
    '&uid=794762570&ver=kwplayer_ar_9.2.2.1&vipver=1&show_copyright_off=1&newver=1' +
    '&ft=music&cluster=0&strategy=2012&encoding=utf8&rformat=json&vermerge=1&mobi=1&issubtitle=1';
  var data = await httpGet(url);
  if (!data || !data.abslist) return [];
  var mInfoReg = /level:(\w+),bitrate:(\d+),format:(\w+),size:([\w.]+)/;
  return data.abslist.map(function(item) {
    var songId = (item.MUSICRID || '').replace('MUSIC_', '');
    var types = [];
    var _types = {};
    if (item.N_MINFO) {
      var infos = item.N_MINFO.split(';');
      infos.forEach(function(info) {
        var m = info.match(mInfoReg);
        if (m) {
          var size = m[4];
          switch (m[2]) {
            case '4000':
              types.push({ type: 'flac24bit', size: size });
              _types.flac24bit = { size: size.toLocaleUpperCase ? size.toLocaleUpperCase() : size };
              break;
            case '2000':
              types.push({ type: 'flac', size: size });
              _types.flac = { size: size.toLocaleUpperCase ? size.toLocaleUpperCase() : size };
              break;
            case '320':
              types.push({ type: '320k', size: size });
              _types['320k'] = { size: size.toLocaleUpperCase ? size.toLocaleUpperCase() : size };
              break;
            case '128':
              types.push({ type: '128k', size: size });
              _types['128k'] = { size: size.toLocaleUpperCase ? size.toLocaleUpperCase() : size };
              break;
          }
        }
      });
    }
    types.reverse();
    // kw image: prefer hts_MVPIC (full URL), fallback to album cover
    var kwImg = item.hts_MVPIC || '';
    if (!kwImg && item.web_albumpic_short) {
      kwImg = 'https://img1.kuwo.cn/star/albumcover/' + item.web_albumpic_short;
    }
    return {
      id: songId,
      name: decodeHTMLEntities(item.SONGNAME || item.NAME || ''),
      singer: decodeHTMLEntities(item.ARTIST || ''),
      albumName: decodeHTMLEntities(item.ALBUM || ''),
      albumId: item.ALBUMID || '',
      img: kwImg,
      interval: formatTime(item.DURATION || 0),
      source: 'kw',
      songmid: songId,
      types: types,
      _types: _types,
    };
  });
}

// ======================== kg (酷狗) search ========================
async function searchKG(keyword, limit) {
  limit = limit || 20;
  var kw = encodeURIComponent(keyword);
  var url = 'https://songsearch.kugou.com/song_search_v2?keyword=' + kw +
    '&page=1&pagesize=' + limit + '&userid=0&platform=WebFilter&filter=2&iscorrection=1&privilege_filter=0&area_code=1';
  var data = await httpGet(url);
  if (!data || data.error_code !== 0 || !data.data || !data.data.lists) return [];
  var seen = {};
  var results = [];
  data.data.lists.forEach(function(item) {
    // Dedup by Audioid+FileHash (matching lx-music-desktop behavior)
    var dedupKey = item.Audioid + item.FileHash;
    if (seen[dedupKey]) return;
    seen[dedupKey] = true;
    results.push(item);
    // Also include Grp (group) alternative versions
    if (item.Grp) {
      item.Grp.forEach(function(child) {
        var childKey = child.Audioid + child.FileHash;
        if (seen[childKey]) return;
        seen[childKey] = true;
        results.push(child);
      });
    }
  });
  return results.map(function(item) {
    var types = [];
    var _types = {};
    if (item.FileSize !== 0) { var sz128 = sizeFormate(item.FileSize); types.push({ type: '128k', size: sz128, hash: item.FileHash }); _types['128k'] = { size: sz128, hash: item.FileHash }; }
    if (item.HQFileSize !== 0) { var sz320 = sizeFormate(item.HQFileSize); types.push({ type: '320k', size: sz320, hash: item.HQFileHash }); _types['320k'] = { size: sz320, hash: item.HQFileHash }; }
    if (item.SQFileSize !== 0) { var szFlac = sizeFormate(item.SQFileSize); types.push({ type: 'flac', size: szFlac, hash: item.SQFileHash }); _types.flac = { size: szFlac, hash: item.SQFileHash }; }
    if (item.ResFileSize !== 0) { var sz24 = sizeFormate(item.ResFileSize); types.push({ type: 'flac24bit', size: sz24, hash: item.ResFileHash }); _types.flac24bit = { size: sz24, hash: item.ResFileHash }; }
    // kg Image field is a template: http://imge.kugou.com/stdmusic/{size}/...
    var kgImg = (item.Image || '').replace('{size}', '480');
    return {
      id: item.Audioid || '',
      name: decodeHTMLEntities(item.SongName || ''),
      singer: decodeHTMLEntities(item.SingerName || ''),
      albumName: decodeHTMLEntities(item.AlbumName || ''),
      albumId: item.AlbumID || '',
      img: kgImg,
      interval: formatTime(item.Duration || 0),
      source: 'kg',
      songmid: item.Audioid || '',
      hash: item.FileHash || item.HQFileHash || '',
      types: types,
      _types: _types,
    };
  });
}

// ======================== tx (QQ) search — lx-music-desktop SDK ========================
// TX crypto: zzcSign (from lx-music-desktop tx/utils/crypto.js)
var TX_PART1_IDX = [23, 14, 6, 36, 16, 40, 7, 19];
var TX_PART2_IDX = [16, 1, 32, 12, 19, 27, 8, 5];
var TX_SCRAMBLE = [89, 39, 179, 150, 218, 82, 58, 252, 177, 52, 186, 123, 120, 64, 242, 133, 143, 161, 121, 179];

function zzcSign(text) {
  var hash = crypto.createHash('sha1').update(text).digest('hex');
  var p1 = TX_PART1_IDX.map(function(i) { return hash[i]; }).join('');
  var p2 = TX_PART2_IDX.map(function(i) { return hash[i]; }).join('');
  var p3 = TX_SCRAMBLE.map(function(v, i) { return v ^ parseInt(hash.slice(i * 2, i * 2 + 2), 16); });
  var b64 = Buffer.from(p3).toString('base64').replace(/[\/+=]/g, '');
  return ('zzc' + p1 + b64 + p2).toLowerCase();
}

async function searchTX(keyword, limit) {
  limit = limit || 20;
  try {
    var body = {
      comm: {
        ct: '11', cv: '14090508', v: '14090508', tmeAppID: 'qqmusic',
        phonetype: 'EBG-AN10', deviceScore: '553.47', devicelevel: '50',
        newdevicelevel: '20', rom: 'HuaWei/EMOTION/EmotionUI_14.2.0',
        os_ver: '12', OpenUDID: '0', OpenUDID2: '0', QIMEI36: '0',
        udid: '0', chid: '0', aid: '0', oaid: '0', taid: '0',
        tid: '0', wid: '0', uid: '0', sid: '0', modeSwitch: '6',
        teenMode: '0', ui_mode: '2', nettype: '1020', v4ip: '',
      },
      req: {
        module: 'music.search.SearchCgiService',
        method: 'DoSearchForQQMusicMobile',
        param: {
          search_type: 0,
          searchid: String(Math.random()).slice(2),
          query: keyword,
          page_num: 1,
          num_per_page: limit,
          highlight: 0, nqc_flag: 0, multi_zhida: 0,
          cat: 2, grp: 1, sin: 0, sem: 0,
        },
      },
    };
    var bodyStr = JSON.stringify(body);
    var sign = zzcSign(bodyStr);
    var result = await httpPost('https://u.y.qq.com/cgi-bin/musics.fcg?sign=' + sign, bodyStr, {
      'User-Agent': 'QQMusic 14090508(android 12)',
    });
    if (!result || result.code !== 0 || !result.req || result.req.code !== 0) return [];
    var rawList = (result.req.data && result.req.data.body && result.req.data.body.item_song) || [];
    if (!Array.isArray(rawList)) return [];
    return rawList.map(function(item) {
      if (!item.file || !item.file.media_mid) return null;
      var types = [];
      var _types = {};
      if (item.file.size_128mp3 !== 0) { var sz128 = sizeFormate(item.file.size_128mp3); types.push({ type: '128k', size: sz128 }); _types['128k'] = { size: sz128 }; }
      if (item.file.size_320mp3 !== 0) { var sz320 = sizeFormate(item.file.size_320mp3); types.push({ type: '320k', size: sz320 }); _types['320k'] = { size: sz320 }; }
      if (item.file.size_flac !== 0) { var szFlac = sizeFormate(item.file.size_flac); types.push({ type: 'flac', size: szFlac }); _types.flac = { size: szFlac }; }
      var albumId = item.album ? item.album.mid : '';
      var albumName = item.album ? item.album.name : '';
      var singerName = (item.singer || []).map(function(s) { return s.name || ''; }).filter(Boolean).join('、');
      return {
        id: String(item.id || ''),
        name: item.title || item.name || '',
        singer: singerName,
        albumName: albumName,
        albumId: albumId,
        songmid: item.mid || '',
        strMediaMid: item.file.media_mid,
        img: albumId ? 'https://y.gtimg.cn/music/photo_new/T002R500x500M000' + albumId + '.jpg' : '',
        interval: formatTime(item.interval || 0),
        source: 'tx',
        types: types,
        _types: _types,
      };
    }).filter(Boolean);
  } catch (e) {
    console.error('[lx-search] tx search error:', e.message);
    return [];
  }
}

// ======================== wy (网易云) search — lx-music-desktop eapi ========================
var WY_EAPI_KEY = 'e82ckenh8dichen8';
var WY_IV = Buffer.from('0102030405060708');
var WY_PRESET_KEY = Buffer.from('0CoJUm6Qyw8W8jud');

function aesEncrypt(buffer, mode, key, iv) {
  var cipher = crypto.createCipheriv(mode, key, iv || '');
  return Buffer.concat([cipher.update(buffer), cipher.final()]);
}

function wyEapi(url, object) {
  var text = typeof object === 'object' ? JSON.stringify(object) : object;
  var message = 'nobody' + url + 'use' + text + 'md5forencrypt';
  var digest = crypto.createHash('md5').update(message).digest('hex');
  var data = url + '-36cd479b6b5-' + text + '-36cd479b6b5-' + digest;
  return { params: aesEncrypt(Buffer.from(data), 'aes-128-ecb', WY_EAPI_KEY, '').toString('hex').toUpperCase() };
}

async function searchWY(keyword, limit) {
  limit = limit || 20;
  try {
    var url = '/api/search/song/list/page';
    var data = {
      keyword: keyword,
      needCorrect: '1',
      channel: 'typing',
      offset: 0,
      scene: 'normal',
      total: true,
      limit: limit,
    };
    var form = wyEapi(url, data);
    var formStr = 'params=' + encodeURIComponent(form.params);
    var rawBody = await httpPostRaw('http://interface.music.163.com/eapi/batch', formStr, {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36',
      'Content-Type': 'application/x-www-form-urlencoded',
      'origin': 'https://music.163.com',
    });
    // Parse raw response (eapi response has JSON at the end after padding)
    var rawStr = rawBody.toString('utf8');
    // Find the last valid JSON object in the response
    var jsonStart = rawStr.indexOf('{"');
    if (jsonStart < 0) { jsonStart = rawStr.indexOf('{'); }
    if (jsonStart < 0) return [];
    try {
      var result = JSON.parse(rawStr.substring(jsonStart));
      if (!result || result.code !== 200 || !result.data) return [];
      var rawList = (result.data.resources || result.data.list || []);
      if (!rawList || !rawList.length) return [];
      return rawList.map(function(resource) {
        // Extract from eapi response: resources[].baseInfo.simpleSongData
        var item = (resource.baseInfo && resource.baseInfo.simpleSongData) || resource.simpleSongData || resource;
        var types = [];
        var _types = {};
        if (item.privilege) {
          if (item.hr && item.privilege.maxBrLevel === 'hires') {
            var sz = item.hr.size ? sizeFormate(item.hr.size) : null;
            types.push({ type: 'flac24bit', size: sz }); _types.flac24bit = { size: sz };
          }
          switch (item.privilege.maxbr) {
            case 999000:
              var szSq = item.sq ? sizeFormate(item.sq.size) : null;
              types.push({ type: 'flac', size: szSq }); _types.flac = { size: szSq };
            case 320000:
              var szH = item.h && item.h.size ? sizeFormate(item.h.size) : null;
              types.push({ type: '320k', size: szH }); _types['320k'] = { size: szH };
            case 128000:
              var szM = item.m && item.m.size ? sizeFormate(item.m.size) : null;
              types.push({ type: '128k', size: szM }); _types['128k'] = { size: szM };
              break;
          }
        }
        var singer = (item.ar || []).map(function(s) { return s.name || ''; }).filter(Boolean).join('、');
        return {
          id: String(item.id || ''),
          name: item.name || '',
          singer: singer,
          albumName: (item.al || {}).name || '',
          albumId: String((item.al || {}).id || ''),
          img: (item.al || {}).picUrl || '',
          interval: formatTime((item.dt || 0) / 1000),
          source: 'wy',
          songmid: String(item.id || ''),
          types: types,
          _types: _types,
        };
      });
    } catch (e) {
      console.error('[lx-search] wy parse error:', e.message);
      return [];
    }
  } catch (e) {
    console.error('[lx-search] wy search error:', e.message);
    return [];
  }
}

// ======================== mg (咪咕) search ========================
function mgSign(time, str) {
  var deviceId = '963B7AA0D21511ED807EE5846EC87D20';
  var signatureMd5 = '6cdc72a439cef99a3418d2a78aa28c73';
  var signStr = str + signatureMd5 + 'yyapp2d16148780a1dcc7408e06336b98cfd50' + deviceId + time;
  return { sign: crypto.createHash('md5').update(signStr).digest('hex'), deviceId: deviceId };
}

async function searchMG(keyword, limit) {
  limit = limit || 20;
  try {
    var time = Date.now().toString();
    var signData = mgSign(time, keyword);
    var searchSwitch = '%7B%22song%22%3A1%2C%22album%22%3A0%2C%22singer%22%3A0%2C%22tagSong%22%3A1%2C%22mvSong%22%3A0%2C%22bestShow%22%3A1%2C%22songlist%22%3A0%2C%22lyricSong%22%3A0%7D';
    var url = 'https://jadeite.migu.cn/music_search/v3/search/searchAll?isCorrect=0&isCopyright=1&searchSwitch=' + searchSwitch +
      '&pageSize=' + limit + '&text=' + encodeURIComponent(keyword) + '&pageNo=1&sort=0&sid=USS';
    var data = await httpGetWithHeaders(url, {
      'uiVersion': 'A_music_3.6.1',
      'deviceId': signData.deviceId,
      'timestamp': time,
      'sign': signData.sign,
      'channel': '0146921',
      'User-Agent': 'Mozilla/5.0 (Linux; U; Android 11.0.0; zh-cn; MI 11 Build/OPR1.170623.032) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30',
    });
    if (!data || data.code !== '000000' || !data.songResultData) return [];
    var rawList = data.songResultData.resultList || [];
    var seen = {};
    var songs = [];
    rawList.forEach(function(group) {
      if (!Array.isArray(group)) return;
      group.forEach(function(item) {
        if (!item.songId || !item.copyrightId || seen[item.copyrightId]) return;
        seen[item.copyrightId] = true;
        var types = [];
        var _types = {};
        (item.audioFormats || []).forEach(function(fmt) {
          var sz = sizeFormate(fmt.asize || fmt.isize || fmt.size);
          switch (fmt.formatType) {
            case 'PQ': types.push({ type: '128k', size: sz }); _types['128k'] = { size: sz }; break;
            case 'HQ': types.push({ type: '320k', size: sz }); _types['320k'] = { size: sz }; break;
            case 'SQ': types.push({ type: 'flac', size: sz }); _types.flac = { size: sz }; break;
            case 'ZQ24': types.push({ type: 'flac24bit', size: sz }); _types.flac24bit = { size: sz }; break;
          }
        });
        var img = item.img3 || item.img2 || item.img1 || null;
        if (img && !/^https?:/i.test(img)) img = 'http://d.musicapp.migu.cn' + img;
        var singerList = (item.singerList || item.singers || []).map(function(s) { return s.name || ''; }).filter(Boolean);
        songs.push({
          id: item.songId || '',
          name: item.name || '',
          singer: singerList.join('、'),
          albumName: item.album || '',
          albumId: item.albumId || '',
          img: img || '',
          interval: formatTime(item.duration || 0),
          source: 'mg',
          songmid: item.songId || '',
          copyrightId: item.copyrightId || '',
          types: types,
          _types: _types,
        });
      });
    });
    return songs;
  } catch (e) {
    console.error('[lx-search] mg search error:', e.message);
    return [];
  }
}

// Helper: HTTP GET with custom headers
function httpGetWithHeaders(url, headers) {
  return new Promise(function(resolve, reject) {
    var mod = url.startsWith('https:') ? https : http;
    var opts = {
      headers: Object.assign({}, headers),
      timeout: 10000,
      agent: getRequestAgent(url),
    };
    mod.get(url, opts, function(res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpGetWithHeaders(res.headers.location, headers).then(resolve).catch(reject);
      }
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { resolve(null); }
      });
    }).on('error', reject);
  });
}

// ======================== unified search ========================
var SEARCHERS = {
  kw: searchKW,
  kg: searchKG,
  tx: searchTX,
  wy: searchWY,
  mg: searchMG,
};

function getSearchableSources(sourceList) {
  return Object.keys(SEARCHERS).filter(function(s) {
    return !sourceList || sourceList.indexOf(s) !== -1;
  });
}

async function searchBySource(source, keyword, limit) {
  var searcher = SEARCHERS[source];
  if (!searcher) throw new Error('Search not implemented for source: ' + source);
  var songs = await searcher(keyword, limit || 20);
  return { provider: source, songs: songs };
}

async function searchAll(keyword, sourceList, limit) {
  limit = limit || 20;
  var sources = getSearchableSources(sourceList);
  if (!sources.length) return { providers: [], songs: [] };
  var results = await Promise.all(sources.map(function(source) {
    return searchBySource(source, keyword, limit).catch(function(err) {
      console.error('[lx-search] ' + source + ' search error:', err.message);
      return { provider: source, songs: [], error: err.message };
    });
  }));
  var allSongs = results.reduce(function(acc, r) { return acc.concat(r.songs.map(function(s) { s.provider = r.provider; return s; })); }, []);
  return { providers: sources, songs: allSongs, results: results };
}

module.exports = {
  searchAll: searchAll,
  searchBySource: searchBySource,
  SEARCHERS: SEARCHERS,
};
