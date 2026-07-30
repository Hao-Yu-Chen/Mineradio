// lx-playlist.js
// LX 模式歌单导入引擎 — 支持网易云/QQ/酷狗/酷我/咪咕歌单链接解析和歌曲列表获取
// 参考 lx-music-desktop musicSdk 各平台 songList 实现

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const zlib = require('zlib');

// ========== HTTP 工具 ==========

var LX_PROXY_HOST = process.env.LX_PROXY_HOST || '127.0.0.1';
var LX_PROXY_PORT = parseInt(process.env.LX_PROXY_PORT || '10808', 10);
var LX_PROXY_ENABLED = process.env.LX_PROXY_ENABLED === '1';

function getRequestAgent(requestUrl) {
  if (!LX_PROXY_ENABLED) return undefined;
  if (/^https:/i.test(requestUrl)) {
    try {
      var tunnel = require('tunnel');
      return tunnel.httpsOverHttp({ proxy: { host: LX_PROXY_HOST, port: LX_PROXY_PORT } });
    } catch (e) { return undefined; }
  } else {
    try {
      var tunnel = require('tunnel');
      return tunnel.httpOverHttp({ proxy: { host: LX_PROXY_HOST, port: LX_PROXY_PORT } });
    } catch (e) { return undefined; }
  }
}

function httpGet(url, headers, timeout) {
  return new Promise(function (resolve, reject) {
    var mod = url.startsWith('https:') ? https : http;
    var opts = { timeout: timeout || 15000, agent: getRequestAgent(url), headers: headers || {} };
    mod.get(url, opts, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpGet(res.headers.location, headers, timeout).then(resolve).catch(reject);
      }
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        resolve({ statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) });
      });
    }).on('error', reject);
  });
}

function httpGetJSON(url, headers, timeout) {
  return httpGet(url, headers, timeout).then(function (r) {
    try { return JSON.parse(r.body.toString('utf8')); }
    catch (e) { return null; }
  });
}

function httpPost(url, body, headers, timeout) {
  return new Promise(function (resolve, reject) {
    var mod = url.startsWith('https:') ? https : http;
    var bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    var hdrs = Object.assign({}, headers || {}, {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(bodyStr),
    });
    var req = mod.request(url, {
      method: 'POST', headers: hdrs, timeout: timeout || 15000, agent: getRequestAgent(url),
    }, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpPost(res.headers.location, body, headers, timeout).then(resolve).catch(reject);
      }
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        resolve({ statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) });
      });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

function httpPostJSON(url, jsonBody, headers, timeout) {
  return new Promise(function (resolve, reject) {
    var mod = url.startsWith('https:') ? https : http;
    var bodyStr = JSON.stringify(jsonBody);
    var hdrs = Object.assign({}, headers || {}, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(bodyStr),
    });
    var req = mod.request(url, {
      method: 'POST', headers: hdrs, timeout: timeout || 15000, agent: getRequestAgent(url),
    }, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpPostJSON(res.headers.location, jsonBody, headers, timeout).then(resolve).catch(reject);
      }
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { resolve(null); }
      });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

// ========== 工具函数 ==========

function decodeHTMLEntities(str) {
  if (!str) return '';
  return String(str)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
}

function decodeName(str) {
  if (!str) return '';
  return decodeHTMLEntities(str).replace(/&#(\d+);/g, function (m, d) {
    return String.fromCharCode(parseInt(d));
  });
}

function formatPlayTime(seconds) {
  var s = Math.floor(seconds || 0);
  var m = Math.floor(s / 60);
  s = s % 60;
  return (m < 10 ? '0' + m : m) + ':' + (s < 10 ? '0' + s : s);
}

function sizeFormate(size) {
  if (!size) return null;
  size = parseInt(size);
  if (size >= 1048576) return (size / 1048576).toFixed(2) + 'MB';
  if (size >= 1024) return (size / 1024).toFixed(2) + 'KB';
  return size + 'B';
}

function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

// ========== NetEase linuxapi 加密 ==========

var LINUXAPI_KEY = Buffer.from('rFgB&h#%2?^eDg:Q');

function aesEncryptECB(text, key) {
  var cipher = crypto.createCipheriv('aes-128-ecb', key, Buffer.alloc(0));
  cipher.setAutoPadding(true);
  var encrypted = Buffer.concat([cipher.update(text), cipher.final()]);
  return encrypted;
}

function linuxapi(object) {
  var text = JSON.stringify(object);
  return {
    eparams: aesEncryptECB(Buffer.from(text), LINUXAPI_KEY).toString('hex').toUpperCase(),
  };
}

// ========== NetEase weapi 加密 (用于 song/detail 批量获取) ==========

var WEAPI_PRESET_KEY = Buffer.from('0CoJUm6Qyw8W8jud');
var WEAPI_IV = Buffer.from('0102030405060708');
var WEAPI_PUBLIC_KEY = '-----BEGIN PUBLIC KEY-----\nMIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB\n-----END PUBLIC KEY-----';
var WEAPI_BASE62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function aesEncryptCBC(text, key, iv) {
  var cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
  cipher.setAutoPadding(true);
  return Buffer.concat([cipher.update(text), cipher.final()]);
}

function weapi(object) {
  var text = JSON.stringify(object);
  // 生成16字节随机密钥
  var secretKey = Buffer.alloc(16);
  for (var i = 0; i < 16; i++) {
    secretKey[i] = WEAPI_BASE62.charCodeAt(Math.floor(Math.random() * WEAPI_BASE62.length));
  }
  var firstEncrypt = aesEncryptCBC(Buffer.from(text), WEAPI_PRESET_KEY, WEAPI_IV);
  var params = aesEncryptCBC(Buffer.from(firstEncrypt.toString('base64')), secretKey, WEAPI_IV).toString('base64');
  // RSA加密secretKey（反转后加密）
  var reversedKey = Buffer.alloc(16);
  for (var i = 0; i < 16; i++) { reversedKey[i] = secretKey[15 - i]; }
  var encSecKey;
  try {
    encSecKey = crypto.publicEncrypt({ key: WEAPI_PUBLIC_KEY, padding: crypto.constants.RSA_NO_PADDING }, Buffer.concat([Buffer.alloc(128 - 16), reversedKey])).toString('hex');
  } catch (e) {
    // RSA_NO_PADDING 在部分Node版本不兼容，回退到 PKCS1 模式
    encSecKey = crypto.publicEncrypt({ key: WEAPI_PUBLIC_KEY, padding: crypto.constants.RSA_PKCS1_PADDING }, reversedKey).toString('hex');
  }
  return { params: params, encSecKey: encSecKey };
}

// ========== URL 自动检测 ==========

function detectPlatform(input) {
  if (!input) return null;
  // 去除首尾空白
  var id = String(input).trim();

  // 网易云
  if (/music\.163\.com/.test(id)) {
    var m = id.match(/[?&]id=(\d+)/) || id.match(/\/playlist\/(\d+)/);
    return m ? { platform: 'wy', id: m[1] } : null;
  }

  // QQ音乐
  if (/y\.qq\.com/.test(id)) {
    var m = id.match(/\/playlist\/(\d+)/) || id.match(/id=(\d+)/);
    return m ? { platform: 'tx', id: m[1] } : null;
  }

  // 酷狗
  if (/kugou\.com/.test(id)) {
    var m = id.match(/\/(\d+)\.html/) || id.match(/global_collection_id=(\w+)/);
    if (m) return { platform: 'kg', id: m[1] };
    // 特殊处理: Kugou short link or special/single
    if (/special\/single\/(\d+)/.test(id)) {
      return { platform: 'kg', id: id.match(/special\/single\/(\d+)/)[1] };
    }
    // For chain patterns
    var chain = id.match(/chain=(\w+)/);
    if (chain) return { platform: 'kg', id: chain[1] };
    return { platform: 'kg', id: id }; // pass through for further parsing
  }

  // 酷我
  if (/kuwo\.cn/.test(id)) {
    var m = id.match(/\/playlist(?:_detail)?\/(\d+)/) || id.match(/pid=(\d+)/);
    return m ? { platform: 'kw', id: m[1] } : null;
  }

  // 咪咕
  if (/migu\.cn/.test(id)) {
    var m = id.match(/\/playlist\/(\d+)/) || id.match(/playlistId=(\d+)/) || id.match(/[?&]id=(\d+)/);
    return m ? { platform: 'mg', id: m[1] } : null;
  }

  return null;
}

// ========== 各平台歌单处理器 ==========

// ----- 网易云 -----

function normalizeWySong(item, privileges) {
  var types = [];
  var _types = {};
  var privilege = null;

  if (privileges) {
    for (var pi = 0; pi < privileges.length; pi++) {
      if (privileges[pi].id === item.id) { privilege = privileges[pi]; break; }
    }
  }

  if (privilege) {
    if (privilege.maxBrLevel === 'hires') {
      var hrSize = item.hr ? sizeFormate(item.hr.size) : null;
      types.push({ type: 'flac24bit', size: hrSize });
      _types.flac24bit = { size: hrSize };
    }
    switch (privilege.maxbr) {
      case 999000:
        types.push({ type: 'flac', size: null });
        _types.flac = { size: null };
      case 320000:
        var hSize = item.h ? sizeFormate(item.h.size) : null;
        types.push({ type: '320k', size: hSize });
        _types['320k'] = { size: hSize };
      case 192000:
      case 128000:
        var lSize = item.l ? sizeFormate(item.l.size) : null;
        types.push({ type: '128k', size: lSize });
        _types['128k'] = { size: lSize };
    }
    types.reverse();
  } else {
    // 没有 privilege 信息时默认添加基础音质
    types.push({ type: '128k', size: null });
    _types['128k'] = { size: null };
  }

  var singer = '';
  if (item.ar) {
    singer = item.ar.map(function (a) { return a.name; }).join('、');
  }

  return {
    name: item.name || '',
    singer: singer,
    source: 'wy',
    songmid: String(item.id),
    interval: formatPlayTime((item.dt || 0) / 1000),
    albumName: item.al ? item.al.name : '',
    albumId: item.al ? item.al.id : '',
    img: item.al ? item.al.picUrl || '' : '',
    types: types,
    _types: _types,
  };
}

// 通过 weapi 批量获取歌曲详情 (每次最多约1000首)
async function _wyFetchSongDetailBatch(ids) {
  var formData = weapi({
    c: '[' + ids.map(function(id) { return '{"id":' + id + '}'; }).join(',') + ']',
    ids: '[' + ids.join(',') + ']',
  });

  var bodyStr = 'params=' + encodeURIComponent(formData.params) + '&encSecKey=' + encodeURIComponent(formData.encSecKey);

  var resp = await httpPost('https://music.163.com/weapi/v3/song/detail', bodyStr, {
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36',
    'Origin': 'https://music.163.com',
  }, 15000);

  if (resp.statusCode !== 200) throw new Error('WY song/detail request failed, HTTP ' + resp.statusCode);
  var body = JSON.parse(resp.body.toString('utf8'));
  if (body.code !== 200) throw new Error('WY song/detail returned error: code=' + body.code);

  return (body.songs || []).map(function (item, index) {
    return normalizeWySong(item, body.privileges);
  });
}

async function fetchWyPlaylist(id) {
  // Step 1: 使用 linuxapi 获取歌单元数据和trackIds
  var formData = linuxapi({
    method: 'POST',
    url: 'https://music.163.com/api/v3/playlist/detail',
    params: { id: id, n: 100000, s: 8 },
  });

  var urlencoded = 'eparams=' + encodeURIComponent(formData.eparams);

  var resp = await httpPost('https://music.163.com/api/linux/forward', urlencoded, {
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36',
    'Cookie': 'MUSIC_U=',
  }, 15000);

  if (resp.statusCode !== 200) throw new Error('WY request failed, HTTP ' + resp.statusCode);
  var body = JSON.parse(resp.body.toString('utf8'));
  if (body.code !== 200) throw new Error('WY returned error: code=' + body.code);

  var playlist = body.playlist;
  var allTrackIds = (playlist.trackIds || []).map(function(t) { return t.id; });
  var songs = [];

  // Step 2: 判断是否需要分批获取歌曲详情
  // 当 tracks 数量 < trackIds 数量时，playlist/detail 只返回了部分歌曲
  var tracksInResponse = (playlist.tracks || []).length;
  var totalTrackCount = allTrackIds.length;

  if (tracksInResponse < totalTrackCount) {
    // 需要分批调用 song/detail 获取全部歌曲详情
    var BATCH_SIZE = 800; // 每批最多获取800首
    for (var offset = 0; offset < totalTrackCount; offset += BATCH_SIZE) {
      var batchIds = allTrackIds.slice(offset, offset + BATCH_SIZE);
      try {
        var batchSongs = await _wyFetchSongDetailBatch(batchIds);
        songs = songs.concat(batchSongs);
      } catch (e) {
        // 重试更小的批次
        console.error('[lx-playlist wy] batch fetch failed, retrying with smaller batch:', e.message);
        var SMALL_BATCH = 400;
        for (var so = offset; so < offset + batchIds.length; so += SMALL_BATCH) {
          var smallIds = allTrackIds.slice(so, so + SMALL_BATCH);
          try {
            var smallSongs = await _wyFetchSongDetailBatch(smallIds);
            songs = songs.concat(smallSongs);
          } catch (e2) {
            console.error('[lx-playlist wy] small batch fetch failed:', e2.message);
          }
        }
      }
    }
  } else {
    // tracks 数组已包含全部歌曲，直接使用
    songs = (playlist.tracks || []).map(function (item, index) {
      return normalizeWySong(item, playlist.privileges);
    });
  }

  return {
    name: playlist.name,
    cover: playlist.coverImgUrl || '',
    songs: songs,
    total: totalTrackCount,
  };
}

// ----- QQ音乐 -----

function normalizeTxSong(item) {
  var types = [];
  var _types = {};

  if (item.file) {
    if (item.file.size_128mp3 !== 0) {
      var sz128 = sizeFormate(item.file.size_128mp3);
      types.push({ type: '128k', size: sz128 });
      _types['128k'] = { size: sz128 };
    }
    if (item.file.size_320mp3 !== 0) {
      var sz320 = sizeFormate(item.file.size_320mp3);
      types.push({ type: '320k', size: sz320 });
      _types['320k'] = { size: sz320 };
    }
    if (item.file.size_flac !== 0) {
      var szFlac = sizeFormate(item.file.size_flac);
      types.push({ type: 'flac', size: szFlac });
      _types.flac = { size: szFlac };
    }
    if (item.file.size_hires !== 0) {
      var szHires = sizeFormate(item.file.size_hires);
      types.push({ type: 'flac24bit', size: szHires });
      _types.flac24bit = { size: szHires };
    }
  }

  var singer = '';
  if (item.singer) {
    singer = item.singer.map(function (s) { return s.name; }).join('、');
  }

  return {
    name: decodeName(item.title || item.name || ''),
    singer: singer,
    source: 'tx',
    songmid: item.mid || String(item.id || ''),
    interval: formatPlayTime(item.interval || 0),
    albumName: decodeName(item.album ? item.album.name : ''),
    albumId: item.album ? item.album.mid : '',
    img: (item.album && item.album.name && item.album.name !== '' && item.album.name !== '空')
      ? 'https://y.gtimg.cn/music/photo_new/T002R500x500M000' + item.album.mid + '.jpg'
      : (item.singer && item.singer.length ? 'https://y.gtimg.cn/music/photo_new/T001R500x500M000' + item.singer[0].mid + '.jpg' : ''),
    types: types,
    _types: _types,
  };
}

async function fetchTxPlaylist(id) {
  var url = 'https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?type=1&json=1&utf8=1&onlysong=0&new_format=1&disstid=' + id + '&loginUin=0&hostUin=0&format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0';

  var resp = await httpGet(url, {
    'Origin': 'https://y.qq.com',
    'Referer': 'https://y.qq.com/n/yqq/playsquare/' + id + '.html',
  }, 15000);

  if (resp.statusCode !== 200) throw new Error('TX request failed, HTTP ' + resp.statusCode);

  var body = JSON.parse(resp.body.toString('utf8'));
  if (body.code !== 0) throw new Error('TX returned error: code=' + body.code);

  var cdlist = body.cdlist[0];
  var songs = (cdlist.songlist || []).map(normalizeTxSong);

  return {
    name: decodeName(cdlist.dissname || ''),
    cover: cdlist.logo || '',
    songs: songs,
    total: cdlist.songlist ? cdlist.songlist.length : 0,
  };
}

// ----- 酷狗 -----

function normalizeKgSong(item) {
  var types = [];
  var _types = {};

  if (item.audio_info) {
    var ai = item.audio_info;
    if (ai.filesize && ai.filesize !== '0') {
      types.push({ type: '128k', size: sizeFormate(parseInt(ai.filesize)), hash: ai.hash });
      _types['128k'] = { size: sizeFormate(parseInt(ai.filesize)), hash: ai.hash };
    }
    if (ai.filesize_320 && ai.filesize_320 !== '0') {
      types.push({ type: '320k', size: sizeFormate(parseInt(ai.filesize_320)), hash: ai.hash_320 });
      _types['320k'] = { size: sizeFormate(parseInt(ai.filesize_320)), hash: ai.hash_320 };
    }
    if (ai.filesize_flac && ai.filesize_flac !== '0') {
      types.push({ type: 'flac', size: sizeFormate(parseInt(ai.filesize_flac)), hash: ai.hash_flac });
      _types.flac = { size: sizeFormate(parseInt(ai.filesize_flac)), hash: ai.hash_flac };
    }
    if (ai.filesize_high && ai.filesize_high !== '0') {
      types.push({ type: 'flac24bit', size: sizeFormate(parseInt(ai.filesize_high)), hash: ai.hash_high });
      _types.flac24bit = { size: sizeFormate(parseInt(ai.filesize_high)), hash: ai.hash_high };
    }
  }

  return {
    name: decodeName(item.songname || item.name || ''),
    singer: decodeName(item.author_name || item.singer || ''),
    source: 'kg',
    songmid: item.audio_info ? item.audio_info.audio_id : (item.songmid || ''),
    interval: item.audio_info ? formatPlayTime(parseInt(item.audio_info.timelength || 0) / 1000) : '00:00',
    albumName: item.album_info ? decodeName(item.album_info.album_name) : '',
    albumId: item.album_info ? item.album_info.album_id : '',
    img: null,
    types: types,
    _types: _types,
  };
}

// 批量获取酷狗歌曲详情 (通过 hash)
async function fetchKgMusicInfoBatch(hashList) {
  var results = [];
  while (hashList.length) {
    var batch = hashList.slice(0, 100);
    hashList = hashList.slice(100);

    var body = {
      area_code: '1',
      show_privilege: 1,
      show_album_info: '1',
      is_publish: '',
      appid: 1005,
      clientver: 11451,
      mid: '1',
      dfid: '-',
      clienttime: Date.now(),
      key: 'OIlwieks28dk2k092lksi2UIkp',
      fields: 'album_info,author_name,audio_info,ori_audio_name,base,songname,classification',
      data: batch,
    };

    try {
      var resp = await httpPostJSON('http://gateway.kugou.com/v3/album_audio/audio', body, {
        'KG-THash': '13a3164',
        'KG-RC': '1',
        'KG-Fake': '0',
        'KG-RF': '00869891',
        'User-Agent': 'Android712-AndroidPhone-11451-376-0-FeeCacheUpdate-wifi',
        'x-router': 'kmr.service.kugou.com',
      }, 15000);

      if (resp && Array.isArray(resp)) {
        for (var i = 0; i < resp.length; i++) {
          if (resp[i] && resp[i][0]) {
            results.push(normalizeKgSong(resp[i][0]));
          }
        }
      } else if (resp && resp.info && Array.isArray(resp.info)) {
        for (var i = 0; i < resp.info.length; i++) {
          if (resp.info[i] && resp.info[i][0]) {
            results.push(normalizeKgSong(resp.info[i][0]));
          }
        }
      }
    } catch (e) {
      // 继续尝试下一批
    }
  }
  return results;
}

async function fetchKgPlaylist(id) {
  // 支持多种ID格式:
  // 1. 纯数字 ID (special/single 页面)
  // 2. URL 格式 (内含 global_collection_id, chain 等)

  var idStr = String(id);

  // 如果是 HTML URL, 提取 special/single/{id}.html
  if (/special\/single\/(\d+)/.test(idStr)) {
    idStr = idStr.match(/special\/single\/(\d+)/)[1];
  }

  if (/^\d+$/.test(idStr)) {
    // 纯数字 ID — 通过 special/single 页面获取
    var htmlUrl = 'http://www2.kugou.kugou.com/yueku/v9/special/single/' + idStr + '-5-9999.html';
    var resp = await httpGet(htmlUrl, {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.198 Safari/537.36',
    }, 15000);

    if (resp.statusCode !== 200) throw new Error('KG request failed, HTTP ' + resp.statusCode);

    var html = resp.body.toString('utf8');

    // 提取 global.data = [...]
    var dataMatch = html.match(/global\.data\s*=\s*(\[[\s\S]*?\])\s*;/);
    if (!dataMatch) throw new Error('KG playlist data parse failed');

    var songList = JSON.parse(dataMatch[1]);
    // 提取歌曲 hash 列表, 批量获取详情
    var hashList = songList.map(function (s) { return { hash: s.hash }; });

    // 提取歌单名称和封面
    var infoMatch = html.match(/global\s*=\s*\{[\s\S]*?name:\s*"([^"]+)"[\s\S]*?pic:\s*"([^"]+)"[\s\S]*?\};/);
    var name = infoMatch ? infoMatch[1] : '';
    var cover = infoMatch ? infoMatch[2] : '';

    var songs = await fetchKgMusicInfoBatch(hashList);

    return { name: name, cover: cover, songs: songs, total: songs.length };
  }

  // 对于其他格式 (URL, chain等), 尝试直接获取 HTML 并解析
  if (/https?:/.test(idStr)) {
    var resp = await httpGet(idStr, {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.198 Safari/537.36',
    }, 15000);

    if (resp.statusCode !== 200) throw new Error('KG request failed, HTTP ' + resp.statusCode);

    var html = resp.body.toString('utf8');
    // 尝试提取 global.data = [...]
    var dataMatch = html.match(/global\.data\s*=\s*(\[[\s\S]*?\])\s*;/);
    if (!dataMatch) {
      // 尝试 dataFromSmarty 格式
      dataMatch = html.match(/var\s+dataFromSmarty\s*=\s*(\[[\s\S]*?\])\s*;/);
    }
    if (!dataMatch) throw new Error('KG playlist data parse failed');

    var songList = JSON.parse(dataMatch[1]);
    var hashList = songList.map(function (s) { return { hash: s.hash }; });

    var infoMatch = html.match(/global\s*=\s*\{[\s\S]*?name:\s*"([^"]+)"[\s\S]*?pic:\s*"([^"]+)"[\s\S]*?\};/);
    var name = infoMatch ? infoMatch[1] : '';
    var cover = infoMatch ? infoMatch[2] : '';

    var songs = await fetchKgMusicInfoBatch(hashList);

    return { name: name, cover: cover, songs: songs, total: songs.length };
  }

  throw new Error('KG playlist ID format not supported');
}

// ----- 酷我 -----

function normalizeKwSong(item) {
  var types = [];
  var _types = {};
  var mInfoRegex = /level:(\w+),bitrate:(\d+),format:(\w+),size:([\w.]+)/;

  if (item.N_MINFO) {
    var infoArr = item.N_MINFO.split(';');
    for (var i = 0; i < infoArr.length; i++) {
      var info = infoArr[i].match(mInfoRegex);
      if (info) {
        switch (info[2]) {
          case '4000':
            types.push({ type: 'flac24bit', size: info[4] });
            _types.flac24bit = { size: info[4].toUpperCase() };
            break;
          case '2000':
            types.push({ type: 'flac', size: info[4] });
            _types.flac = { size: info[4].toUpperCase() };
            break;
          case '320':
            types.push({ type: '320k', size: info[4] });
            _types['320k'] = { size: info[4].toUpperCase() };
            break;
          case '128':
            types.push({ type: '128k', size: info[4] });
            _types['128k'] = { size: info[4].toUpperCase() };
            break;
        }
      }
    }
    types.reverse();
  }

  return {
    name: decodeName(item.name || ''),
    singer: decodeName(item.artist || ''),
    source: 'kw',
    songmid: String(item.id || ''),
    interval: formatPlayTime(parseInt(item.duration || 0)),
    albumName: decodeName(item.album || ''),
    albumId: item.albumid || '',
    img: null,
    types: types,
    _types: _types,
  };
}

async function fetchKwPlaylist(id) {
  var url = 'http://nplserver.kuwo.cn/pl.svc?op=getlistinfo&pid=' + id + '&pn=0&rn=1000&encode=utf8&keyset=pl2012&identity=kuwo&pcmp4=1&vipver=MUSIC_9.0.5.0_W1&newver=1';

  var resp = await httpGet(url, {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.198 Safari/537.36',
  }, 15000);

  if (resp.statusCode !== 200) throw new Error('KW request failed, HTTP ' + resp.statusCode);

  var body = JSON.parse(resp.body.toString('utf8'));
  if (body.result !== 'ok') throw new Error('KW returned error: result=' + body.result);

  var songs = (body.musiclist || []).map(normalizeKwSong);

  return {
    name: body.title || '',
    cover: body.pic || '',
    songs: songs,
    total: body.total || songs.length,
  };
}

// ----- 咪咕 -----

function normalizeMgSong(item) {
  var types = [];
  var _types = {};

  // 咪咕返回的音质信息在 rateFormats 或 newRateFormats
  if (item.newRateFormats && Array.isArray(item.newRateFormats)) {
    for (var i = 0; i < item.newRateFormats.length; i++) {
      var f = item.newRateFormats[i];
      var typeName = '';
      if (f.resourceType === '3D' || f.formatType === 'FLAC') {
        typeName = 'flac';
      } else if (f.formatType === 'HQ' || f.rate === 320) {
        typeName = '320k';
      } else if (f.formatType === 'PQ' || f.rate === 128) {
        typeName = '128k';
      }
      if (typeName) {
        types.push({ type: typeName, size: f.size ? sizeFormate(parseInt(f.size)) : null });
        _types[typeName] = { size: f.size ? sizeFormate(parseInt(f.size)) : null };
      }
    }
    types.reverse();
  } else {
    // 默认音质
    types.push({ type: '128k', size: null });
    _types['128k'] = { size: null };
  }

  // 咪咕的歌手可能在 singers 数组或 singer 字段
  var singer = '';
  if (item.singers && Array.isArray(item.singers)) {
    singer = item.singers.map(function (s) { return s.name; }).join('、');
  } else if (item.singer) {
    singer = item.singer;
  }

  return {
    name: item.name || item.songName || '',
    singer: singer,
    source: 'mg',
    songmid: String(item.id || item.songId || ''),
    interval: formatPlayTime(0),
    albumName: item.albumName || (item.album ? item.album.name : '') || '',
    albumId: item.albumId || (item.album ? item.album.id : '') || '',
    img: item.img || (item.album ? item.album.img : '') || '',
    types: types,
    _types: _types,
  };
}

async function fetchMgPlaylist(id) {
  var headers = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1',
    'Referer': 'https://m.music.migu.cn/',
  };

  // 并行获取歌单歌曲和歌单信息
  var songsUrl = 'https://app.c.nf.migu.cn/MIGUM3.0/resource/playlist/song/v2.0?pageNo=1&pageSize=500&playlistId=' + id;
  var infoUrl = 'https://c.musicapp.migu.cn/MIGUM3.0/resource/playlist/v2.0?playlistId=' + id;

  var songsResp = await httpGetJSON(songsUrl, headers, 15000);
  var infoResp = await httpGetJSON(infoUrl, headers, 15000);

  var songs = [];
  if (songsResp && songsResp.code === '000000' && songsResp.data && songsResp.data.songList) {
    songs = songsResp.data.songList.map(normalizeMgSong);
  }

  var name = '';
  var cover = '';
  if (infoResp && infoResp.code === '000000' && infoResp.data) {
    name = infoResp.data.title || '';
    cover = infoResp.data.imgItem ? infoResp.data.imgItem.img : '';
  }

  return {
    name: name,
    cover: cover,
    songs: songs,
    total: songsResp && songsResp.data ? (songsResp.data.totalCount || songs.length) : songs.length,
  };
}

// ========== 平台处理器映射 ==========

var PLATFORM_HANDLERS = {
  wy: { fetch: fetchWyPlaylist, name: 'WY' },
  tx: { fetch: fetchTxPlaylist, name: 'TX' },
  kg: { fetch: fetchKgPlaylist, name: 'KG' },
  kw: { fetch: fetchKwPlaylist, name: 'KW' },
  mg: { fetch: fetchMgPlaylist, name: 'MG' },
};

// ========== 统一入口 ==========

/**
 * 获取在线歌单
 * @param {string} input - 歌单链接或ID
 * @param {string} platformHint - 用户指定的平台 ('auto'|'wy'|'tx'|'kg'|'kw'|'mg')
 * @returns {Promise<{ok:boolean, name?:string, cover?:string, songs?:Array, total?:number, platform?:string, error?:string}>}
 */
async function fetchPlaylist(input, platformHint) {
  if (!input || !String(input).trim()) {
    return { ok: false, error: '请输入歌单链接或ID' };
  }

  var platform = 'auto';
  var id = String(input).trim();

  // 如果用户指定了平台(非auto), 直接使用
  if (platformHint && platformHint !== 'auto' && PLATFORM_HANDLERS[platformHint]) {
    platform = platformHint;
  } else {
    // 自动检测
    var detected = detectPlatform(id);
    if (detected) {
      platform = detected.platform;
      id = detected.id;
    } else if (/^\d+$/.test(id)) {
      // 纯数字ID但无法自动检测 — 需要用户指定平台
      return { ok: false, error: '纯数字ID无法自动检测平台，请手动选择平台' };
    }
  }

  if (!PLATFORM_HANDLERS[platform]) {
    return { ok: false, error: '不支持的平台: ' + platform };
  }

  try {
    var result = await PLATFORM_HANDLERS[platform].fetch(id);
    // 过滤掉没有有效songmid的歌曲
    result.songs = result.songs.filter(function (s) {
      return s && s.songmid && s.name;
    });
    return {
      ok: true,
      name: result.name,
      cover: result.cover,
      songs: result.songs,
      total: result.total,
      platform: platform,
    };
  } catch (e) {
    return { ok: false, error: PLATFORM_HANDLERS[platform].name + '歌单获取失败: ' + (e.message || String(e)) };
  }
}

// ========== 本地文件导入 ==========

/**
 * 读取本地歌单文件 (.json / .lxmc)
 * @param {string} filePath - 文件路径
 * @returns {{name:string, songs:Array}}
 */
function readLocalFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error('文件不存在: ' + filePath);
  }

  var raw = fs.readFileSync(filePath);
  var isLxmc = filePath.endsWith('.lxmc');

  // .lxmc 文件是 gzip 压缩的 JSON
  if (isLxmc) {
    raw = zlib.gunzipSync(raw);
  }

  var data;
  try {
    data = JSON.parse(raw.toString('utf8'));
  } catch (e) {
    throw new Error('文件格式无效，无法解析JSON');
  }

  // 兼容 lx-music-desktop 的 playListPart_v2 格式
  if (data.type === 'playListPart' || data.type === 'playListPart_v2') {
    var listData = data.data;
    if (!listData || !listData.list) {
      throw new Error('歌单文件格式无效: 缺少 data.list');
    }
    return {
      name: listData.name || '导入歌单',
      songs: listData.list.filter(function (s) { return s && s.name; }),
    };
  }

  // 兼容简单格式 { name: "...", songs: [...] }
  if (data.songs && Array.isArray(data.songs)) {
    return {
      name: data.name || '导入歌单',
      songs: data.songs.filter(function (s) { return s && s.name; }),
    };
  }

  // 兼容纯数组格式
  if (Array.isArray(data)) {
    return {
      name: '导入歌单',
      songs: data.filter(function (s) { return s && s.name; }),
    };
  }

  // 兼容 lx-music-desktop 的完整备份格式
  if (data.type === 'allData' || data.type === 'allData_v2' || data.type === 'playList' || data.type === 'playList_v2') {
    // 可能需要进一步处理, 暂时只返回第一个歌单
    if (data.data && data.data.defaultList && data.data.defaultList.length) {
      return {
        name: '导入歌单',
        songs: data.data.defaultList.filter(function (s) { return s && s.name; }),
      };
    }
  }

  throw new Error('不支持的文件格式。支持: playListPart_v2, 简单JSON歌单, 歌曲数组');
}

module.exports = {
  detectPlatform: detectPlatform,
  fetchPlaylist: fetchPlaylist,
  readLocalFile: readLocalFile,
  PLATFORM_HANDLERS: PLATFORM_HANDLERS,
};
