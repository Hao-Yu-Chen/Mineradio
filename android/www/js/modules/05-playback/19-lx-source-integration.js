// ====== LX (落雪) 音乐源前端集成 ======
// 本模块提供 LX 音源管理、搜索集成、歌单系统、喜欢/收藏功能
// 通过 monkey-patching 接入新模块化架构

// --- LX 状态扩展 fxDefaults ---
if (typeof fxDefaults === 'object') {
  if (!('lxSourceEnabled' in fxDefaults)) fxDefaults.lxSourceEnabled = false;
  if (!('lxActiveSourceId' in fxDefaults)) fxDefaults.lxActiveSourceId = null;
  }

// --- LX 模式独立歌单系统 ---
var LX_PLAYLISTS_KEY = 'mineradio-lx-playlists-v2';
var lxPlaylists = [];
(function(){
  try { lxPlaylists = JSON.parse(localStorage.getItem(LX_PLAYLISTS_KEY)) || []; } catch(e) { lxPlaylists = []; }
  if (!lxPlaylists.find(function(p){ return p.id === 'lx_fav'; })) {
    lxPlaylists.unshift({ id: 'lx_fav', name: '我的喜欢', songs: [], createdAt: new Date().toISOString() });
    }
})();

// --- 序列化补丁 ---
(function patchSaveLoad() {
  if (typeof saveLyricLayout === 'function') {
    var _origSaveLL = saveLyricLayout;
    saveLyricLayout = function() {
      _origSaveLL();
      // lxSourceEnabled and lxActiveSourceId are already in fx, saved by original
    };
    }

  if (typeof saveQueueState === 'function') {
    var _origSaveQS = saveQueueState;
    saveQueueState = function() {
      if (typeof fx !== 'undefined' && fx && fx.lxSourceEnabled) {
        // Don't save stub entries for LX mode
        }
      _origSaveQS();
    };
    }
})();

// --- LX 工具函数 ---
function lxSongKey(song) {
  if (!song) return '';
  return (song.provider || song.source || '') + ':' + (song.songmid || song.id || '');
  }

function lxGetFavoritePlaylist() { return lxPlaylists.find(function(p){ return p.id === 'lx_fav'; }); }

function isLxSongLiked(song) {
  var fav = lxGetFavoritePlaylist();
  return !!(fav && fav.songs.some(function(s){ return lxSongKey(s) === lxSongKey(song); }));
  }

function isLxSourceSong(song) {
  if (!song) return false;
  if (typeof fx === 'undefined' || !fx || !fx.lxSourceEnabled) return false;
  var src = (song.provider || song.source || '').toLowerCase();
  if (!src) return false;
  // Known LX source codes
  if (['kw','kg','tx','wy','mg'].indexOf(src) >= 0) return true;
  // Also check for LX-specific markers
  if (song._lxFallbackAudioUrl) return true;
  return false;
  }

function lxStoreSong(song) {
  return {
    name: song.name || '', artist: song.artist || song.singer || '',
    id: song.id || '', songmid: song.songmid || song.id || '',
    source: song.provider || song.source || '',
    cover: song.cover || song.img || '',
    interval: song.interval || '',
    album: song.album || song.albumName || '',
    albumId: song.albumId || '',
    types: song.types || [], _types: song._types || {},
    hash: song.hash || '', copyrightId: song.copyrightId || ''
  };
  }

function saveLxPlaylists() { try { localStorage.setItem(LX_PLAYLISTS_KEY, JSON.stringify(lxPlaylists)); } catch(e) {} }

function normalizeLxSearchSong(s) {
  if (!s) return null;
  var coverImg = s.img || '';
  return {
    id: s.id || s.songmid || '',
    name: s.name || '',
    artist: s.singer || s.artist || '',
    album: s.albumName || s.album || '',
    albumId: s.albumId || '',
    img: coverImg,
    cover: coverImg,
    interval: s.interval || '',
    source: s.provider || s.source || 'kw',
    songmid: s.songmid || s.id || '',
    provider: s.provider || s.source || 'kw',
    hash: s.hash || '',
    copyrightId: s.copyrightId || '',
    types: s.types || [],
    _types: s._types || {},
  };
  }

// --- LX 歌单操作 ---
function addToLxPlaylist(plId, song) {
  var pl = lxPlaylists.find(function(p) { return p.id === plId; });
  if (!pl) return;
  if (pl.songs.some(function(s) { return lxSongKey(s) === lxSongKey(song); })) {
    if (typeof showToast === 'function') showToast('歌曲已在歌单中'); return;
    }
  pl.songs.push(lxStoreSong(song));
  saveLxPlaylists();
  if (typeof showToast === 'function') showToast('已收藏到 ' + pl.name);
  }

function createLxPlaylist(name) {
  name = (name || '').trim();
  if (!name) { if (typeof showToast === 'function') showToast('请输入歌单名称'); return null; }
  var pl = { id: 'lx_pl_' + Date.now(), name: name, songs: [], createdAt: new Date().toISOString() };
  lxPlaylists.push(pl);
  saveLxPlaylists();
  return pl;
  }

function removeLxPlaylist(plId) {
  if (plId === 'lx_fav') { if (typeof showToast === 'function') showToast('我的喜欢不可删除'); return; }
  if (!confirm('确定要删除这个歌单吗？')) return;
  lxPlaylists = lxPlaylists.filter(function(p) { return p.id !== plId; });
  saveLxPlaylists();
  if (lxSidebarExpanded === plId) lxSidebarExpanded = null;
  renderLxSidebarPlaylists();
  if (typeof showToast === 'function') showToast('歌单已删除');
  }

function removeLxPlaylistSong(plId, idx) {
  var pl = lxPlaylists.find(function(p) { return p.id === plId; });
  if (!pl || idx < 0 || idx >= pl.songs.length) return;
  pl.songs.splice(idx, 1);
  saveLxPlaylists();
  renderLxSidebarPlaylists();
  if (typeof showToast === 'function') showToast('已从歌单移除');
  }

function playLxPlaylist(plId) {
  var pl = lxPlaylists.find(function(p) { return p.id === plId; });
  if (!pl || !pl.songs.length) { if (typeof showToast === 'function') showToast('歌单为空'); return; }
  playQueue = pl.songs.map(function(s) {
    return normalizeLxSearchSong({
      name: s.name, singer: s.artist, id: s.songmid || s.id, songmid: s.songmid || s.id,
      source: s.source, provider: s.source, img: s.cover, interval: s.interval,
      albumName: s.album, albumId: s.albumId, types: s.types, _types: s._types,
      hash: s.hash, copyrightId: s.copyrightId
    });
  });
  currentIdx = 0;
  if (typeof safeRenderQueuePanel === 'function') safeRenderQueuePanel('lx-playlist-play', { scrollCurrent: typeof miniQueueOpen !== 'undefined' ? miniQueueOpen : false });
  if (typeof safeShelfRebuild === 'function') safeShelfRebuild('lx-playlist-play');
  if (typeof playQueueAt === 'function') playQueueAt(0);
  }

function playLxPlaylistSong(plId, idx) {
  var pl = lxPlaylists.find(function(p) { return p.id === plId; });
  if (!pl || !pl.songs.length || idx < 0 || idx >= pl.songs.length) return;
  playQueue = pl.songs.map(function(s) {
    return normalizeLxSearchSong({
      name: s.name, singer: s.artist, id: s.songmid || s.id, songmid: s.songmid || s.id,
      source: s.source, provider: s.source, img: s.cover, interval: s.interval,
      albumName: s.album, albumId: s.albumId, types: s.types, _types: s._types,
      hash: s.hash, copyrightId: s.copyrightId
    });
  });
  currentIdx = idx;
  // 立即更新底部栏封面/名称，提供即时点击反馈（与普通模式一致）
  var song = playQueue[idx];
  if (song) {
    try { document.getElementById('hint').classList.add('hidden'); } catch(e) {}
    var tt = document.getElementById('thumb-title'); if (tt) tt.textContent = song.name || '';
    var ta = document.getElementById('thumb-artist'); if (ta) ta.textContent = song.artist || '';
    if (typeof updateControlTrackInfo === 'function') updateControlTrackInfo(song);
    var tw = document.getElementById('thumb-wrap'); if (tw) tw.classList.add('visible');
  }
  if (typeof safeRenderQueuePanel === 'function') safeRenderQueuePanel('lx-playlist-song', { scrollCurrent: typeof miniQueueOpen !== 'undefined' ? miniQueueOpen : false });
  if (typeof safeShelfRebuild === 'function') safeShelfRebuild('lx-playlist-song');
  if (typeof playQueueAt === 'function') playQueueAt(idx);
  }

function updateLxLocalCounts() {
  if (typeof queueViewTab !== 'undefined' && queueViewTab === 'playlists' && typeof fx !== 'undefined' && fx && fx.lxSourceEnabled) renderLxSidebarPlaylists();
  renderLxSidebar();
  }

// --- LX 歌单 sidebar ---
var lxSidebarExpanded = null;

function renderLxSidebar() {
  var plTab = document.getElementById('tab-pl');
  var podcastTab = document.getElementById('tab-podcast');
  if (typeof fx === 'undefined' || !fx) return;
  if (fx.lxSourceEnabled) {
    if (plTab) plTab.textContent = 'LX歌单';
    if (podcastTab) podcastTab.style.display = 'none';
    var pp = document.getElementById('podcast-pane');
    if (pp) pp.style.display = 'none';
  } else {
    if (plTab) plTab.textContent = '我的歌单';
    if (podcastTab) podcastTab.style.display = '';
    }
  if (typeof queueViewTab !== 'undefined' && queueViewTab === 'playlists' && fx.lxSourceEnabled) renderLxSidebarPlaylists();
  }

function toggleLxSidebarExpand(id) {
  lxSidebarExpanded = lxSidebarExpanded === id ? null : id;
  renderLxSidebarPlaylists();
  }

function renderLxSidebarPlaylists() {
  var plList = document.getElementById('pl-list');
  if (!plList) return;
  var html = '';
  for (var i = 0; i < lxPlaylists.length; i++) {
    var pl = lxPlaylists[i];
    var isFav = pl.id === 'lx_fav';
    var expanded = lxSidebarExpanded === pl.id;
    html += '<div class="pl-card" style="margin:6px 0;border-radius:10px;cursor:pointer;background:' + (isFav ? 'rgba(255,122,144,0.06)' : 'rgba(255,255,255,0.03)') + ';border:1px solid ' + (isFav ? 'rgba(255,122,144,0.18)' : 'rgba(255,255,255,0.06)') + '" onclick="toggleLxSidebarExpand(\'' + pl.id + '\')">';
    html += '<div style="padding:12px;display:flex;align-items:center;gap:10px">' +
      '<div style="font-size:' + (isFav ? '18' : '14') + 'px">' + (isFav ? '❤' : '📋') + '</div>' +
      '<div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHTML(pl.name) + '</div>' +
      '<div style="font-size:11px;color:rgba(255,255,255,0.4);margin-top:2px">' + pl.songs.length + ' 首' + (expanded ? ' ▲' : ' ▼') + '</div></div>' +
      '</div>';
    if (expanded) {
      html += '<div style="padding:0 12px 8px">';
      html += '<div style="display:flex;gap:6px;margin-bottom:6px">' +
        '<button style="flex:1;padding:6px;border-radius:6px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.06);color:#fff;cursor:pointer;font-size:11px" onclick="event.stopPropagation();playLxPlaylist(\'' + pl.id + '\')">▶ 播放全部</button>' +
        (isFav ? '' : '<button style="padding:6px 10px;border-radius:6px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03);color:rgba(255,255,255,.3);font-size:10px;cursor:pointer;transition:all .2s;flex-shrink:0" onclick="event.stopPropagation();removeLxPlaylist(\'' + pl.id + '\')" title="删除歌单" onmouseenter="this.style.background=\'rgba(255,80,60,.15)\';this.style.color=\'#ff7060\';this.style.borderColor=\'rgba(255,80,60,.25)\'" onmouseleave="this.style.background=\'rgba(255,255,255,.03)\';this.style.color=\'rgba(255,255,255,.3)\';this.style.borderColor=\'rgba(255,255,255,.08)\'">删除歌单</button>') +
        '</div>';
      if (!pl.songs.length) {
        html += '<div style="color:rgba(255,255,255,0.3);text-align:center;padding:8px;font-size:11px">暂无歌曲</div>';
      } else {
        for (var j = 0; j < pl.songs.length; j++) {
          var s = pl.songs[j];
          html += '<div class="lx-song-row" style="display:flex;align-items:center;gap:8px;padding:5px 8px;cursor:pointer;border-radius:4px;font-size:11px" onclick="event.stopPropagation();playLxPlaylistSong(\'' + pl.id + '\',' + j + ')" onmouseenter="this.style.background=\'rgba(255,255,255,0.05)\'" onmouseleave="this.style.background=\'transparent\'">' +
            '<span style="color:rgba(255,255,255,0.35);min-width:18px;text-align:right">' + (j + 1) + '</span>' +
            '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHTML(s.name || '未知歌曲') + '</span>' +
            '<span style="color:rgba(255,255,255,0.3);font-size:10px">' + escapeHTML((s.artist || '').split(',')[0] || '') + '</span>' +
            '<button class="lx-song-del" style="flex-shrink:0;width:18px;height:18px;border-radius:50%;border:1px solid rgba(255,255,255,.08);background:transparent;color:rgba(255,255,255,.25);font-size:10px;cursor:pointer;line-height:1;padding:0;transition:all .2s" onclick="event.stopPropagation();removeLxPlaylistSong(\'' + pl.id + '\',' + j + ')" title="从歌单移除" onmouseenter="this.style.background=\'rgba(255,80,60,.2)\';this.style.color=\'#ff7060\';this.style.borderColor=\'rgba(255,80,60,.3)\'" onmouseleave="this.style.background=\'transparent\';this.style.color=\'rgba(255,255,255,.25)\';this.style.borderColor=\'rgba(255,255,255,.08)\'">×</button>' +
            '</div>';
        }
      }
      html += '</div>';
    }
    html += '</div>';
  }
  plList.innerHTML = html;
}

function escapeHTML(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

// --- LX 收藏弹窗 ---
function renderLxCollectModal() {
  var current = document.getElementById('collect-current');
  if (current) {
    var s = typeof collectTargetSong !== 'undefined' ? collectTargetSong : null;
    current.innerHTML = (s && s.name) ? ('<img src="' + (s.cover || s.img || '') + '" onerror="this.style.display=\'none\'" style="width:40px;height:40px;border-radius:6px;object-fit:cover;flex-shrink:0"><span>' + escapeHTML(s.name) + ' — ' + escapeHTML(s.artist || s.singer || '') + '</span>') : '';
    }
  var list = document.getElementById('collect-list');
  if (!list) return;
  var html = '';
  var fav = lxGetFavoritePlaylist();
  if (fav) {
    html += '<div class="collect-pl-item" onclick="addToLxPlaylist(\'lx_fav\', collectTargetSong); closeCollectModal();" style="cursor:pointer;padding:10px;border-radius:8px;margin:4px 0;background:rgba(255,122,144,0.08);display:flex;justify-content:space-between;align-items:center"><span>❤ ' + escapeHTML(fav.name) + '</span><span style="color:rgba(255,255,255,0.4);font-size:11px">' + fav.songs.length + ' 首</span></div>';
    }
  for (var i = 0; i < lxPlaylists.length; i++) {
    var pl = lxPlaylists[i];
    if (pl.id === 'lx_fav') continue;
    html += '<div class="collect-pl-item" onclick="addToLxPlaylist(\'' + pl.id + '\', collectTargetSong); closeCollectModal();" style="cursor:pointer;padding:10px;border-radius:8px;margin:4px 0;background:rgba(255,255,255,0.04);display:flex;justify-content:space-between;align-items:center"><span>' + escapeHTML(pl.name) + '</span><span style="color:rgba(255,255,255,0.4);font-size:11px">' + pl.songs.length + ' 首</span></div>';
    }
  if (lxPlaylists.length <= 1) html += '<div style="color:rgba(255,255,255,0.35);padding:20px;text-align:center">暂无歌单，请先创建</div>';
  list.innerHTML = html;
  }

// --- Monkey-patch: createPlaylistFromCollect (保存原始版本) ---
var _lxOrigCreatePlaylistFromCollect = (typeof createPlaylistFromCollect === 'function') ? createPlaylistFromCollect : null;

createPlaylistFromCollect = function() {
  var target = typeof collectTargetSong !== 'undefined' ? collectTargetSong : null;
  if (target && isLxSourceSong(target)) {
    // LX 模式：创建本地歌单
    var input = document.getElementById('collect-new-name');
    var name = input ? input.value.trim() : '';
    if (!name) { if (typeof showToast === 'function') showToast('请输入歌单名称'); return; }
    var pl = createLxPlaylist(name);
    if (!pl) return;
    if (target) {
      pl.songs.push(lxStoreSong(target));
      saveLxPlaylists();
      }
    if (input) input.value = '';
    renderLxCollectModal();
    return;
    }
  // 非 LX 模式：委托给原始函数
  if (_lxOrigCreatePlaylistFromCollect) {
    return _lxOrigCreatePlaylistFromCollect();
    }
  // 回退
  var input = document.getElementById('collect-new-name');
  if (input) input.value = '';
};

// --- LX 源管理 ---
var lxSourceCache = null;

function fetchLxSources() {
  return fetch('/api/lx/sources').then(function(r) { return r.json(); }).then(function(d) {
    lxSourceCache = d.sources || [];
    return lxSourceCache;
  }).catch(function(err) {
    console.error('[lx] fetch sources error:', err);
    return lxSourceCache || [];
  });
  }

function fetchLxStatus() {
  return fetch('/api/lx/status').then(function(r) { return r.json(); }).then(function(d) {
    return d;
  }).catch(function(err) {
    console.error('[lx] fetch status error:', err);
    var enabled = (typeof fx !== 'undefined' && fx && fx.lxSourceEnabled) ? true : false;
    return { enabled: enabled, sourceCount: 0, sources: [], _error: true };
  });
  }

function setLxMode(mode) {
  var enabled = mode === 'lx';
  if (typeof fx !== 'undefined' && fx) fx.lxSourceEnabled = enabled;
  fetch('/api/lx/set-active', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: enabled, activeId: (typeof fx !== 'undefined' && fx && fx.lxActiveSourceId) ? fx.lxActiveSourceId : undefined }),
  }).then(function(r) { return r.json(); }).then(function(d) {
    if (d.ok && typeof fx !== 'undefined' && fx) { fx.lxActiveSourceId = d.status.activeId; }
    updateLxUI();
    if (typeof saveLyricLayout === 'function') saveLyricLayout();
    if (typeof showToast === 'function') showToast(enabled ? '已切换到 LX 源模式' : '已切换回默认模式');
  }).catch(function(err) {
    console.error('[lx] set mode error:', err);
    updateLxUI();
    if (typeof saveLyricLayout === 'function') saveLyricLayout();
  });
  }

function setLxActiveSource(id) {
  if (typeof fx !== 'undefined' && fx) fx.lxActiveSourceId = id;
  fetch('/api/lx/set-active', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ activeId: id, enabled: true }),
  }).then(function(r) { return r.json(); }).then(function() {
    updateLxUI();
    if (typeof saveLyricLayout === 'function') saveLyricLayout();
    if (typeof showToast === 'function') showToast('已切换活跃源');
  }).catch(function(err) { console.error('[lx] set active error:', err); });
  }

function showLxImportInput() {
  var row = document.getElementById('lx-import-row');
  var btn = document.getElementById('lx-import-btn');
  var input = document.getElementById('lx-import-url');
  if (row) row.style.display = 'flex';
  if (btn) btn.style.display = 'none';
  if (input) { input.value = ''; setTimeout(function(){ input.focus(); }, 100); }
  }
function hideLxImportInput() {
  var row = document.getElementById('lx-import-row');
  var btn = document.getElementById('lx-import-btn');
  if (row) row.style.display = 'none';
  if (btn) btn.style.display = '';
  }
function doLxImport() {
  var input = document.getElementById('lx-import-url');
  var url = input ? input.value.trim() : '';
  if (!url) { if (typeof showToast === 'function') showToast('请输入 URL'); return; }
  if (!/^https?:\/\//i.test(url)) { if (typeof showToast === 'function') showToast('请输入有效的 http/https 地址'); return; }
  var confirmBtn = document.getElementById('lx-import-confirm');
  var cancelBtn = document.getElementById('lx-import-cancel');
  if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = '导入中...'; }
  if (cancelBtn) cancelBtn.disabled = true;
  fetch('/api/lx/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: url }),
  }).then(function(r) { return r.json(); }).then(function(d) {
    if (d.ok) {
      if (typeof showToast === 'function') showToast('源导入成功: ' + (d.source.name || 'unknown'));
      if (typeof fx !== 'undefined' && fx) {
        fx.lxActiveSourceId = d.source.id;
        fx.lxSourceEnabled = true;
        }
      return fetch('/api/lx/set-active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activeId: d.source.id, enabled: true }),
      }).then(function() { return d; });
    } else {
      if (typeof showToast === 'function') showToast('导入失败: ' + (d.error || 'unknown error'));
      throw new Error('import failed');
      }
  }).then(function(d) {
    if (!d) return;
    hideLxImportInput();
    updateLxUI();
    if (typeof saveLyricLayout === 'function') saveLyricLayout();
  }).catch(function(err) {
    if (err.message !== 'import failed') {
      console.error('[lx] import error:', err);
      if (typeof showToast === 'function') showToast('导入失败: 网络错误');
      }
  }).then(function() {
    if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = '确认'; }
    if (cancelBtn) { cancelBtn.disabled = false; }
  });
  }

function showLxLocalImportInput() {
  var row = document.getElementById('lx-import-local-row');
  var btn = document.getElementById('lx-import-local-btn');
  var input = document.getElementById('lx-import-local-path');
  hideLxImportInput();
  if (row) row.style.display = 'flex';
  if (btn) btn.style.display = 'none';
  if (input) { input.value = ''; setTimeout(function(){ input.focus(); }, 100); }
  }
function hideLxLocalImportInput() {
  var row = document.getElementById('lx-import-local-row');
  var btn = document.getElementById('lx-import-local-btn');
  if (row) row.style.display = 'none';
  if (btn) btn.style.display = '';
  }
function doLxLocalImport() {
  var input = document.getElementById('lx-import-local-path');
  var filePath = input ? input.value.trim() : '';
  if (!filePath) { if (typeof showToast === 'function') showToast('请输入文件路径'); return; }
  var confirmBtn = document.getElementById('lx-import-local-confirm');
  var cancelBtn = document.getElementById('lx-import-local-cancel');
  if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = '导入中...'; }
  if (cancelBtn) cancelBtn.disabled = true;
  fetch('/api/lx/import-local', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filePath: filePath }),
  }).then(function(r) { return r.json(); }).then(function(d) {
    if (d.ok) {
      if (typeof showToast === 'function') showToast('本地源导入成功: ' + (d.source.name || 'unknown'));
      if (typeof fx !== 'undefined' && fx) {
        fx.lxActiveSourceId = d.source.id;
        fx.lxSourceEnabled = true;
        }
      return fetch('/api/lx/set-active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activeId: d.source.id, enabled: true }),
      }).then(function() { return d; });
    } else {
      if (typeof showToast === 'function') showToast('导入失败: ' + (d.error || 'unknown error'));
      throw new Error('import failed');
      }
  }).then(function(d) {
    if (!d) return;
    hideLxLocalImportInput();
    updateLxUI();
    if (typeof saveLyricLayout === 'function') saveLyricLayout();
  }).catch(function(err) {
    if (err.message !== 'import failed') {
      console.error('[lx] local import error:', err);
      if (typeof showToast === 'function') showToast('导入失败: ' + (err.message || '未知错误'));
      }
  }).then(function() {
    if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = '确认'; }
    if (cancelBtn) { cancelBtn.disabled = false; }
  });
  }

function refreshLxSource(id) {
  fetch('/api/lx/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: id }),
  }).then(function(r) { return r.json(); }).then(function(d) {
    if (d.ok) { if (typeof showToast === 'function') showToast('源已刷新'); }
    else { if (typeof showToast === 'function') showToast('刷新失败: ' + (d.error || 'unknown')); }
    updateLxUI();
  }).catch(function(err) {
    console.error('[lx] refresh error:', err);
    if (typeof showToast === 'function') showToast('刷新失败: 网络错误');
  });
  }

function deleteLxSource(id) {
  if (!confirm('确定要删除这个音乐源吗？')) return;
  fetch('/api/lx/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: id }),
  }).then(function(r) { return r.json(); }).then(function(d) {
    if (d.ok) {
      if (typeof fx !== 'undefined' && fx && fx.lxActiveSourceId === id) fx.lxActiveSourceId = null;
      if (typeof showToast === 'function') showToast('源已删除');
    } else { if (typeof showToast === 'function') showToast('删除失败'); }
    updateLxUI();
    if (typeof saveLyricLayout === 'function') saveLyricLayout();
  }).catch(function(err) {
    console.error('[lx] delete error:', err);
    if (typeof showToast === 'function') showToast('删除失败');
  });
  }

function renderLxSourceList(sources, activeId) {
  if (!sources || !sources.length) {
    return '<div style="font-size:10.5px;color:rgba(255,255,255,.38);padding:6px 0">暂无导入的源，点击上方按钮导入。</div>';
    }
  return sources.map(function(s) {
    var platBadges = (s.sources || []).map(function(p) {
      return '<span class="src-platform">' + p + '</span>';
    }).join('');
    return '<div class="lx-source-item">' +
      '<span class="lx-status-dot ' + (s.loaded ? 'on' : 'err') + '" style="flex-shrink:0;width:6px;height:6px"></span>' +
      '<div class="src-info">' +
        '<div class="src-name">' + escapeHTML(s.name || 'unknown') + ' <span style="font-weight:400;color:rgba(255,255,255,.35)">v' + escapeHTML(s.version || '') + '</span></div>' +
        '<div class="src-meta">' + platBadges + ' · ' + escapeHTML(s.author || 'unknown') + '</div>' +
      '</div>' +
      '<div class="src-actions">' +
        '<button class="src-act-btn" onclick="refreshLxSource(\'' + s.id + '\')" title="刷新">刷新</button>' +
        '<button class="src-act-btn danger" onclick="deleteLxSource(\'' + s.id + '\')" title="删除">删</button>' +
      '</div>' +
    '</div>';
  }).join('');
  }

function updateLxUI() {
  if (window.location.search.indexOf('lx=1') >= 0 && typeof fx !== 'undefined' && fx && !fx.lxSourceEnabled) {
    fx.lxSourceEnabled = true;
    fetch('/api/lx/set-active', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({enabled:true})}).catch(function(){});
    }
  fetchLxSources().then(function(sources) {
    fetchLxStatus().then(function(status) {
      if (!status._error && typeof fx !== 'undefined' && fx) {
        if (status.enabled && !fx.lxSourceEnabled) {
          fx.lxSourceEnabled = true;
          fx.lxActiveSourceId = status.activeId;
          if (typeof saveLyricLayout === 'function') saveLyricLayout();
        } else if (!status.enabled && fx.lxSourceEnabled) {
          fx.lxSourceEnabled = false;
          if (typeof saveLyricLayout === 'function') saveLyricLayout();
          }
        if (status.enabled && status.activeId && status.activeId !== fx.lxActiveSourceId) {
          fx.lxActiveSourceId = status.activeId;
          if (typeof saveLyricLayout === 'function') saveLyricLayout();
          }
          }
      var modeSeg = document.getElementById('lx-mode-seg');
      if (modeSeg && typeof fx !== 'undefined' && fx) {
        modeSeg.querySelectorAll('button').forEach(function(b) {
          b.classList.toggle('active', (b.dataset.lxMode === 'lx') === !!fx.lxSourceEnabled);
        });
        }
      var activeSection = document.getElementById('lx-active-source-section');
      var activeSeg = document.getElementById('lx-active-source-seg');
      if (activeSection && activeSeg && typeof fx !== 'undefined' && fx) {
        if (fx.lxSourceEnabled && sources.length > 0) {
          activeSection.style.display = '';
          activeSeg.innerHTML = sources.map(function(s) {
            return '<button data-lx-sid="' + s.id + '" class="' + (s.id === fx.lxActiveSourceId ? 'active' : '') + '">' + escapeHTML(s.name) + '</button>';
          }).join('');
          activeSeg.querySelectorAll('button').forEach(function(b) {
            b.addEventListener('click', function() { setLxActiveSource(b.dataset.lxSid); });
          });
        } else {
          activeSection.style.display = 'none';
          }
          }
      var list = document.getElementById('lx-source-list');
      if (list) { list.innerHTML = renderLxSourceList(sources, typeof fx !== 'undefined' && fx ? fx.lxActiveSourceId : null); }
      var dot = document.getElementById('lx-status-dot');
      var text = document.getElementById('lx-status-text');
      if (dot && text) {
        var enabled = typeof fx !== 'undefined' && fx && fx.lxSourceEnabled;
        if (enabled && sources.length > 0) {
          dot.className = 'lx-status-dot on';
          var activeSrc = sources.find(function(s) { return typeof fx !== 'undefined' && fx && s.id === fx.lxActiveSourceId; });
          text.textContent = activeSrc ? 'LX 源 · ' + activeSrc.name + ' · ' + (activeSrc.sources || []).join(', ') : 'LX 源已启用';
        } else if (enabled && !sources.length) {
          dot.className = 'lx-status-dot err';
          text.textContent = 'LX 源已启用但无可用源，请先导入';
        } else {
          dot.className = 'lx-status-dot off';
          text.textContent = '默认模式 · 网易云 / QQ 音乐';
          }
          }
      updateLxLocalCounts();
      if (typeof updateSearchModeTabs === 'function') updateSearchModeTabs();
    });
  });
  }

// ====== Monkey-patch 核心功能 ======
// 这些补丁在模块加载时同步执行，覆写后续会被调用的函数

// --- 搜索模式标签: 直接覆写 updateSearchModeTabs ---
(function patchSearchTabs() {
  if (typeof updateSearchModeTabs !== 'function') {
    // 如果还没加载，延迟重试（理论上不应该发生，因为 07-search.js 在前面）
    var _retry = function() {
      if (typeof updateSearchModeTabs !== 'function') { setTimeout(_retry, 50); return; }
      patchSearchTabs();
    };
    setTimeout(_retry, 50);
    return;
    }
  var _origUpdateSearchModeTabs = updateSearchModeTabs;
  updateSearchModeTabs = function() {
    var enabled = typeof fx !== 'undefined' && fx && fx.lxSourceEnabled;
    if (!enabled) {
      // LX 未启用：隐藏 LX 按钮，恢复原始标签
      var lxC = document.getElementById('lx-search-mode-btns');
      if (lxC) { lxC.style.display = 'none'; lxC.innerHTML = ''; }
      return _origUpdateSearchModeTabs();
      }
    // LX 已启用：隐藏平台按钮，显示 LX 源按钮
    var tabs = document.getElementById('search-mode-tabs');
    if (!tabs) return;
    var btns = ['search-mode-netease','search-mode-qq','search-mode-kugou','search-mode-qishui','search-mode-spotify','search-mode-podcast'];
    btns.forEach(function(id) { var b = document.getElementById(id); if (b) b.style.display = 'none'; });
    var lxContainer = document.getElementById('lx-search-mode-btns');
    if (!lxContainer) {
      lxContainer = document.createElement('span');
      lxContainer.id = 'lx-search-mode-btns';
      tabs.appendChild(lxContainer);
      }
    var activeSrc = lxSourceCache ? lxSourceCache.find(function(s) { return typeof fx !== 'undefined' && fx && s.id === fx.lxActiveSourceId; }) : null;
    var srcList = activeSrc && activeSrc.sources ? activeSrc.sources : ['kw','kg','tx','wy','mg'];
    var labels = { kw: 'KW', kg: 'KG', tx: 'TX', wy: 'WY', mg: 'MG' };
    if (typeof searchMode !== 'undefined' && srcList.indexOf(searchMode) === -1) searchMode = 'song';
    lxContainer.style.display = '';
    lxContainer.innerHTML = srcList.map(function(src) {
      return '<button type="button" class="' + (typeof searchMode !== 'undefined' && searchMode === src ? 'active' : '') + '" onclick="setSearchMode(\'' + src + '\')">' + (labels[src] || src.toUpperCase()) + '</button>';
    }).join('');
    var songBtn = document.getElementById('search-mode-song');
    if (songBtn) { songBtn.textContent = 'All'; songBtn.classList.toggle('active', typeof searchMode !== 'undefined' && searchMode === 'song'); }
  };
})();

// --- 搜索: 补丁 fetchMusicSearchResults (仅用于分页加载) ---
(function patchSearch() {
  function doPatch() {
    if (typeof fetchMusicSearchResults !== 'function') { setTimeout(doPatch, 100); return; }
    var _origFetchMusicSearchResults = fetchMusicSearchResults;
    fetchMusicSearchResults = function(q, mode, previousPages) {
      // LX 模式下，分页加载也走 LX API
      if (typeof fx !== 'undefined' && fx && fx.lxSourceEnabled) {
        var lxSearchUrl = '/api/lx/search?keywords=' + encodeURIComponent(q) + '&limit=18';
        if (mode && mode !== 'song') lxSearchUrl += '&source=' + encodeURIComponent(mode);
        return (typeof apiJson === 'function' ? apiJson(lxSearchUrl) : fetch(lxSearchUrl).then(function(r){ return r.json(); })).then(function(lxResult) {
          var lxSongs = (lxResult.songs || []).map(normalizeLxSearchSong).filter(function(s) { return s && s.id; });
          return { songs: lxSongs, providerPages: {}, hasMore: false };
        });
        }
      return _origFetchMusicSearchResults(q, mode, previousPages);
    };
    }
  doPatch();
})();

// --- 搜索: 覆写 doSearch — LX 模式走完全独立的搜索+渲染管线 ---
(function patchDoSearch() {
  function doPatch() {
    if (typeof doSearch !== 'function') { setTimeout(doPatch, 100); return; }
    var _origDoSearch = doSearch;
    doSearch = function(q, opts) {
      // 非 LX 模式：委托原始函数
      if (!(typeof fx !== 'undefined' && fx && fx.lxSourceEnabled)) {
        return _origDoSearch(q, opts);
        }
      // === LX 模式独立搜索 ===
      opts = opts || {};
      q = String(q || '').trim();
      if (!q) {
        if (typeof renderSearchHistory === 'function') renderSearchHistory();
        return;
        }
      var mode = typeof searchMode !== 'undefined' ? searchMode : 'song';
      var lxSearchUrl = '/api/lx/search?keywords=' + encodeURIComponent(q) + '&limit=18';
      if (mode && mode !== 'song') lxSearchUrl += '&source=' + encodeURIComponent(mode);
      // 显示 loading
      var $results = document.getElementById('search-results');
      var $input = document.getElementById('search-input');
      if ($results) {
        $results.innerHTML = '<div class="search-empty">正在搜索 "' + escHtmlLx(q) + '"…</div>';
        $results.classList.add('show');
        }
      (typeof apiJson === 'function' ? apiJson(lxSearchUrl) : fetch(lxSearchUrl).then(function(r){ return r.json(); }))
        .then(function(lxResult) {
          // 检查搜索条件是否已过期
          var curQ = $input ? $input.value.trim() : '';
          if (curQ !== q) return;
          var curMode = typeof searchMode !== 'undefined' ? searchMode : 'song';
          if (curMode !== mode) return;
          var lxSongs = (lxResult.songs || []).map(normalizeLxSearchSong).filter(function(s) { return s && s.id; });
          if (typeof playlist !== 'undefined') playlist = lxSongs;
          if (typeof searchLastResultQuery !== 'undefined') searchLastResultQuery = q;
          if (typeof searchMusicRenderState !== 'undefined') {
            searchMusicRenderState.key = q;
            searchMusicRenderState.query = q;
            searchMusicRenderState.mode = mode;
            searchMusicRenderState.songs = lxSongs;
            searchMusicRenderState.visibleCount = lxSongs.length;
            searchMusicRenderState.remoteHasMore = false;
            searchMusicRenderState.providerPages = {};
            }
          if (!$results) return;
          if (!lxSongs.length) {
            $results.innerHTML = '<div class="search-empty">没有找到相关歌曲</div>';
            $results.classList.add('show');
            return;
            }
          // 直接渲染 LX 搜索结果
          var html = '';
          for (var i = 0; i < lxSongs.length; i++) {
            html += renderLxSearchResultHtml(lxSongs[i], i);
            }
          $results.innerHTML = html;
          $results.classList.add('show');
          // 动画
          if (window.gsap && typeof animateListItems === 'function') {
            try { animateListItems($results, '.search-result', { x: 0, y: 6, stagger: 0.012, duration: 0.18, limit: 18 }); } catch(e) {}
            }
          // 更新喜欢状态
          updateLxLikeButtons();
        }).catch(function(err) {
          console.error('[LX] doSearch error:', err);
          if ($results) {
            $results.innerHTML = '<div class="search-empty">搜索失败，请稍后重试</div>';
            $results.classList.add('show');
            }
        });
    };
    }
  doPatch();
})();

// LX 搜索结果 HTML 渲染
function renderLxSearchResultHtml(s, i) {
  var thumb = s.cover || s.img || '';
  var imgTag = thumb
    ? '<img src="' + coverUrlWithSizeLx(thumb, 80) + '" alt="" loading="lazy" onerror="this.style.opacity=0.2">'
    : '<div style="width:40px;height:40px;border-radius:6px;background:rgba(255,255,255,0.06);flex-shrink:0"></div>';
  var liked = isLxSongLiked(s);
  var sourceTag = '<span class="search-source-tag" style="font-size:9px;padding:1px 5px;border-radius:3px;background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.5);margin-left:6px;text-transform:uppercase">' + escHtmlLx((s.provider || s.source || '').toUpperCase()) + '</span>';
  return '<div class="search-result ' + (s.provider || s.source || '') + '-source">' +
    '<div style="display:flex;align-items:center;gap:12px;flex:1;min-width:0;cursor:pointer" onclick="playLxSearchResult(' + i + ')">' +
    imgTag +
    '<div class="search-result-info">' +
    '<div class="search-result-title">' + escHtmlLx(s.name || '') + sourceTag + '</div>' +
    '<div class="search-result-meta">' + escHtmlLx(s.artist || s.singer || '') + (s.albumName || s.album ? ' · ' + escHtmlLx(s.albumName || s.album || '') : '') + '</div>' +
    '</div>' +
    '</div>' +
    '<button class="song-action-btn' + (liked ? ' liked' : '') + '" title="' + (liked ? '取消红心' : '红心喜欢') + '" onclick="event.stopPropagation();toggleLxLikeSearchResult(' + i + ')">' + (typeof heartIconSvg === 'function' ? heartIconSvg() : '♥') + '</button>' +
    '<button class="song-action-btn" title="收藏到歌单" onclick="event.stopPropagation();openLxCollectForResult(' + i + ')">' + (typeof playlistPlusIconSvg === 'function' ? playlistPlusIconSvg() : '+') + '</button>' +
    '<button class="add-btn" title="下一首播放" onclick="event.stopPropagation();queueSearchResult(' + i + ')">+</button>' +
    '</div>';
    }

function playLxSearchResult(i) {
  if (typeof playlist === 'undefined' || !playlist || i < 0 || i >= playlist.length) return;
  var song = playlist[i];
  if (!song) return;
  // 关闭搜索结果和输入，与 upstream playSearchResult 一致
  var $results = document.getElementById('search-results');
  var $input = document.getElementById('search-input');
  if ($results) $results.classList.remove('show');
  if ($input) { $input.value = ''; $input.blur(); }
  // 隐藏首页
  if (typeof homeForcedOpen !== 'undefined') homeForcedOpen = false;
  if (typeof homeSuppressed !== 'undefined') homeSuppressed = false;
  if (typeof setHomeControlsLocked === 'function') setHomeControlsLocked(false);
  // clone song 确保有完整属性
  if (typeof cloneSong === 'function') song = cloneSong(song);
  else if (typeof hydrateCustomCover === 'function') song = hydrateCustomCover(song);
  // 追加到队列末尾并立即播放
  if (typeof playQueue === 'undefined') return;
  playQueue.push(song);
  if (typeof currentIdx !== 'undefined') currentIdx = playQueue.length - 1;
  // 立即更新底部栏封面/名称，提供即时点击反馈（与普通模式一致）
  try { document.getElementById('hint').classList.add('hidden'); } catch(e) {}
  var tt = document.getElementById('thumb-title'); if (tt) tt.textContent = song.name || '';
  var ta = document.getElementById('thumb-artist'); if (ta) ta.textContent = song.artist || '';
  if (typeof updateControlTrackInfo === 'function') updateControlTrackInfo(song);
  var tw = document.getElementById('thumb-wrap'); if (tw) tw.classList.add('visible');
  if (typeof saveQueueState === 'function') saveQueueState();
  if (typeof safeRenderQueuePanel === 'function') safeRenderQueuePanel('lx-search-play', { scrollCurrent: true });
  if (typeof safeShelfRebuild === 'function') safeShelfRebuild('lx-search-play');
  if (typeof playQueueAt === 'function') playQueueAt(currentIdx);
  }

function toggleLxLikeSearchResult(i) {
  if (typeof playlist === 'undefined' || !playlist || i < 0 || i >= playlist.length) return;
  var song = playlist[i];
  var lxKey = lxSongKey(song);
  if (!lxKey) return;
  var fav = lxGetFavoritePlaylist();
  if (!fav) return;
  var idx = fav.songs.findIndex(function(s){ return lxSongKey(s) === lxKey; });
  if (idx >= 0) {
    fav.songs.splice(idx, 1);
    saveLxPlaylists();
    if (typeof showToast === 'function') showToast('已取消红心');
  } else {
    fav.songs.push(lxStoreSong(song));
    saveLxPlaylists();
    if (typeof showToast === 'function') showToast('已加入红心喜欢');
    }
  updateLxLikeButtons();
  updateLxLocalCounts();
  }

function openLxCollectForResult(i) {
  if (typeof playlist === 'undefined' || !playlist || i < 0 || i >= playlist.length) return;
  if (typeof collectTargetSong === 'undefined') return;
  collectTargetSong = playlist[i];
  renderLxCollectModal();
  if (typeof openGsapModal === 'function') openGsapModal(document.getElementById('collect-modal'));
  }

function updateLxLikeButtons() {
  if (typeof playlist === 'undefined') return;
  var btns = document.querySelectorAll('.song-action-btn[data-lx-like]');
  // Full re-render of like states from current playlist
  var likeBtns = document.querySelectorAll('.search-result .song-action-btn');
  likeBtns.forEach(function(btn, i) {
    if (playlist[i] && isLxSourceSong(playlist[i])) {
      btn.classList.toggle('liked', isLxSongLiked(playlist[i]));
      }
  });
  }

function coverUrlWithSizeLx(url, size) {
  if (!url) return '';
  if (typeof coverUrlWithSize === 'function') return coverUrlWithSize(url, size);
  return url;
  }

function escHtmlLx(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

// --- 播放搜索结果: 覆写 playSearchResult 让 LX 歌曲正确播放 ---
(function patchPlaySearchResult() {
  function doPatch() {
    if (typeof playSearchResult !== 'function') { setTimeout(doPatch, 100); return; }
    var _origPlaySearchResult = playSearchResult;
    playSearchResult = function(i) {
      if (typeof playlist === 'undefined' || !playlist || i < 0 || i >= playlist.length) return;
      var song = playlist[i];
      if (song && isLxSourceSong(song)) {
        if (typeof cloneSong === 'function') song = cloneSong(song);
        else if (typeof hydrateCustomCover === 'function') song = hydrateCustomCover(song);
        if (typeof playQueue === 'undefined') return;
        playQueue.push(song);
        if (typeof currentIdx !== 'undefined') currentIdx = playQueue.length - 1;
        if (typeof saveQueueState === 'function') saveQueueState();
        if (typeof safeRenderQueuePanel === 'function') safeRenderQueuePanel('lx-play', { scrollCurrent: true });
        if (typeof safeShelfRebuild === 'function') safeShelfRebuild('lx-play');
        if (typeof playQueueAt === 'function') playQueueAt(currentIdx);
        return;
        }
      return _origPlaySearchResult(i);
    };
    }
  doPatch();
})();

(function patchSetSearchMode() {
  function doPatch() {
    if (typeof setSearchMode !== 'function') { setTimeout(doPatch, 100); return; }
    var _origSetSearchMode = setSearchMode;
    var LX_SOURCES = ['kw','kg','tx','wy','mg'];
    setSearchMode = function(mode) {
      var lxEnabled = typeof fx !== 'undefined' && fx && fx.lxSourceEnabled;
      if (lxEnabled) {
        // LX 模式下允许 LX 源代码作为有效搜索模式
        var validLx = (mode === 'song' || LX_SOURCES.indexOf(mode) >= 0);
        if (!validLx) mode = 'song';
        // 直接设置 searchMode，绕过原始函数的白名单检查
        if (typeof searchMode !== 'undefined' && searchMode === mode) return;
        searchMode = mode;
        updateSearchModeTabs();
        if (typeof clearSearchResults === 'function') clearSearchResults();
        var searchArea = document.getElementById('search-area');
        if (searchArea && typeof setPeek === 'function') setPeek(searchArea, true, 'search');
        var q = (typeof $input !== 'undefined' && $input) ? $input.value.trim() : '';
        if (q) {
          if (typeof doSearch === 'function') doSearch(q);
        } else {
          if (typeof renderSearchHistory === 'function') renderSearchHistory();
          }
        return;
        }
      // 非 LX 模式：委托给原始函数
      return _origSetSearchMode(mode);
    };
    }
  doPatch();
})();

// --- 喜欢状态检测: 补丁 isSongLiked 让 LX 歌曲正确显示红心 ---
(function patchIsSongLiked() {
  function doPatch() {
    if (typeof isSongLiked !== 'function') { setTimeout(doPatch, 100); return; }
    var _origIsSongLiked = isSongLiked;
    isSongLiked = function(song) {
      if (isLxSourceSong(song)) {
        return isLxSongLiked(song);
        }
      return _origIsSongLiked(song);
    };
    }
  doPatch();
})();

// --- 喜欢: 补丁 toggleLikeSong ---
(function patchLike() {
  function doPatch() {
    if (typeof toggleLikeSong !== 'function') { setTimeout(doPatch, 100); return; }
    var _origToggleLikeSong = toggleLikeSong;
    toggleLikeSong = function(song) {
      if (isLxSourceSong(song)) {
        var lxKey = lxSongKey(song);
        if (!lxKey) return;
        var fav = lxGetFavoritePlaylist();
        if (!fav) return;
        var idx = fav.songs.findIndex(function(s){ return lxSongKey(s) === lxKey; });
        if (idx >= 0) {
          fav.songs.splice(idx, 1);
          saveLxPlaylists();
          if (typeof updateLikeButtons === 'function') updateLikeButtons(song);
          if (typeof safeRenderQueuePanel === 'function') safeRenderQueuePanel('lx-like-remove', { scrollCurrent: typeof miniQueueOpen !== 'undefined' ? miniQueueOpen : false });
          if (typeof refreshSearchResultActionStates === 'function') refreshSearchResultActionStates();
          if (typeof showToast === 'function') showToast('已取消红心');
        } else {
          fav.songs.push(lxStoreSong(song));
          saveLxPlaylists();
          if (typeof updateLikeButtons === 'function') updateLikeButtons(song);
          if (typeof safeRenderQueuePanel === 'function') safeRenderQueuePanel('lx-like-add', { scrollCurrent: typeof miniQueueOpen !== 'undefined' ? miniQueueOpen : false });
          if (typeof refreshSearchResultActionStates === 'function') refreshSearchResultActionStates();
          if (typeof showToast === 'function') showToast('已加入红心喜欢');
          }
        updateLxLocalCounts();
        return;
        }
      return _origToggleLikeSong(song);
    };
    }
  doPatch();
})();

// --- 收藏: 补丁 openCollectModal ---
(function patchCollect() {
  function doPatch() {
    if (typeof openCollectModal !== 'function') { setTimeout(doPatch, 100); return; }
    var _origOpenCollectModal = openCollectModal;
    openCollectModal = function(song) {
      if (isLxSourceSong(song)) {
        if (!song || !lxSongKey(song)) return;
        collectTargetSong = song;
        renderLxCollectModal();
        if (typeof openGsapModal === 'function') openGsapModal(document.getElementById('collect-modal'));
        return;
        }
      return _origOpenCollectModal(song);
    };
    }
  doPatch();
})();

// --- 切换歌单标签: 补丁 switchPlaylistTab ---
(function patchSwitchPlaylistTab() {
  function doPatch() {
    if (typeof switchPlaylistTab !== 'function') { setTimeout(doPatch, 100); return; }
    var _origSwitchPlaylistTab = switchPlaylistTab;
    switchPlaylistTab = function(tab) {
      var lxEnabled = typeof fx !== 'undefined' && fx && fx.lxSourceEnabled;
      if (lxEnabled) {
        tab = tab === 'podcasts' ? 'playlists' : (tab === 'playlists' ? 'playlists' : 'queue');
        var podcastTab = document.getElementById('tab-podcast');
        var plTab = document.getElementById('tab-pl');
        if (podcastTab) podcastTab.style.display = 'none';
        if (plTab) plTab.textContent = 'LX歌单';
        var podcastPane = document.getElementById('podcast-pane');
        if (podcastPane) podcastPane.style.display = 'none';
        document.getElementById('tab-queue').classList.toggle('active', tab === 'queue');
        if (plTab) plTab.classList.toggle('active', tab === 'playlists');
        document.getElementById('queue-pane').style.display = tab === 'queue' ? '' : 'none';
        document.getElementById('pl-pane').style.display = tab === 'playlists' ? '' : 'none';
        if (tab === 'playlists') renderLxSidebarPlaylists();
        if (tab === 'queue' && typeof animateVisiblePanelList === 'function') animateVisiblePanelList(document.getElementById('queue-list'), '.queue-item', document.getElementById('playlist-panel'), '.queue-item.now');
        if (tab === 'playlists' && typeof animateVisiblePanelList === 'function') animateVisiblePanelList(document.getElementById('pl-list'), '.pl-card', document.getElementById('playlist-panel'));
        return;
        }
      return _origSwitchPlaylistTab(tab);
    };
    }
  doPatch();
})();

// --- 喜欢状态检测: 补丁 refreshSearchResultActionStates ---
(function patchActionStates() {
  function doPatch() {
    if (typeof refreshSearchResultActionStates !== 'function') { setTimeout(doPatch, 100); return; }
    var _origRefreshSearchResultActionStates = refreshSearchResultActionStates;
    refreshSearchResultActionStates = function() {
      _origRefreshSearchResultActionStates();
      // Also update LX like states
      var lxEnabled = typeof fx !== 'undefined' && fx && fx.lxSourceEnabled;
      if (lxEnabled && typeof playlist !== 'undefined') {
        var likeBtns = document.querySelectorAll('.search-result-item .like-btn, .action-btn.like-btn');
        likeBtns.forEach(function(btn, i) {
          if (playlist[i] && isLxSourceSong(playlist[i])) {
            if (isLxSongLiked(playlist[i])) {
              btn.classList.add('liked');
            } else {
              btn.classList.remove('liked');
              }
              }
        });
        }
    };
    }
  doPatch();
})();

// --- 搜索补丁: openArtistDetailForSong ---
(function patchArtistDetail() {
  function doPatch() {
    if (typeof openArtistDetailForSong !== 'function') { setTimeout(doPatch, 100); return; }
    var _origOpenArtistDetailForSong = openArtistDetailForSong;
    openArtistDetailForSong = function(song) {
      if (isLxSourceSong(song) && typeof fx !== 'undefined' && fx && fx.lxSourceEnabled) {
        var artist = song.artist || song.singer || '';
        var provider = song.provider || song.source || 'kw';
        if (!artist.trim()) return;
        var url = '/api/lx/search?keywords=' + encodeURIComponent(artist) + '&source=' + encodeURIComponent(provider) + '&limit=10';
        if (typeof apiJson !== 'function') return;
        apiJson(url).then(function(result) {
          var songs = (result.songs || []).map(normalizeLxSearchSong).filter(function(s) { return s && s.id; });
          if (typeof playlist !== 'undefined') {
            playlist = songs;
            if (typeof renderSearchResults === 'function') renderSearchResults(songs);
            }
        }).catch(function(err) {
          console.error('[lx] artist detail error:', err);
        });
        return;
        }
      return _origOpenArtistDetailForSong(song);
    };
    }
  doPatch();
})();

// --- 歌词: 补丁 lyricEndpointForSong 支持 LX 源 ---
(function patchLyricEndpoint() {
  function doPatch() {
    if (typeof lyricEndpointForSong !== 'function') { setTimeout(doPatch, 100); return; }
    var _origLyricEndpointForSong = lyricEndpointForSong;
    lyricEndpointForSong = function(songOrId) {
      var song = (songOrId && typeof songOrId === 'object') ? songOrId : null;
      if (song && isLxSourceSong(song)) {
        var src = (song.provider || song.source || '').toLowerCase();
        if (src === 'kw') return '/api/kw/lyric?id=' + encodeURIComponent(song.id || song.songmid || '');
        if (src === 'kg') return '/api/kg/lyric?name=' + encodeURIComponent(song.name || '') + '&hash=' + encodeURIComponent(song.hash || song.songmid || '') + '&time=' + encodeURIComponent(song.interval || '');
        if (src === 'tx') {
          var mid = song.mid || song.songmid || song.id || '';
          var qqId = song.qqId || (/^\d+$/.test(String(song.id || '')) ? song.id : '');
          return '/api/qq/lyric?mid=' + encodeURIComponent(mid) + '&id=' + encodeURIComponent(qqId);
          }
        if (src === 'wy') return '/api/lyric?id=' + encodeURIComponent(song.id || song.songmid || '');
        if (src === 'mg') return '/api/lyric?id=' + encodeURIComponent(song.copyrightId || song.id || '');
        // 兜底：用歌名歌手去网易云搜索
        return '/api/lyric?id=' + encodeURIComponent(song.id || song.songmid || '');
        }
      return _origLyricEndpointForSong(songOrId);
    };
    }
  doPatch();
})();

// --- 自动换源回退: 补丁 tryAutoPlaybackFallback ---
(function patchAutoFallback() {
  function doPatch() {
    if (typeof tryAutoPlaybackFallback !== 'function') { setTimeout(doPatch, 100); return; }
    var _origTryAutoPlaybackFallback = tryAutoPlaybackFallback;
    tryAutoPlaybackFallback = function(song, data, idx, token, opts) {
      // 仅拦截 LX 源歌曲，非 LX 歌曲委托给原始函数
      if (song && isLxSourceSong(song)) {
        return tryLxSourceFallback(song, idx, token, opts);
        }
      return _origTryAutoPlaybackFallback(song, data, idx, token, opts);
    };
    }
  doPatch();
})();

// --- 播放 URL 解析: 补丁 playQueueAt 支持 LX 歌曲 ---
(function patchPlayQueueAt() {
  function doPatch() {
    if (typeof playQueueAt !== 'function') { setTimeout(doPatch, 100); return; }
    var _origPlayQueueAt = playQueueAt;
    playQueueAt = async function(idx, opts) {
      opts = opts || {};
      var song = (typeof playQueue !== 'undefined' && playQueue && idx >= 0 && idx < playQueue.length) ? playQueue[idx] : null;
      // 如果是 LX 歌曲且没有预先解析的 URL，先通过 LX API 获取播放 URL
      // 但在网络请求之前：立即暂停当前音频并更新底部栏，给用户即时反馈
      if (song && isLxSourceSong(song) && !opts.preResolvedPlaybackData && !opts.lxFallbackUrl && !opts.autoRepeat) {
        if (typeof pauseCurrentAudioForTrackSwitch === 'function') pauseCurrentAudioForTrackSwitch();
        try { document.getElementById('hint').classList.add('hidden'); } catch(e) {}
        var _tt = document.getElementById('thumb-title'); if (_tt) _tt.textContent = song.name || '';
        var _ta = document.getElementById('thumb-artist'); if (_ta) _ta.textContent = song.artist || '';
        if (typeof updateControlTrackInfo === 'function') updateControlTrackInfo(song);
        var _tw = document.getElementById('thumb-wrap'); if (_tw) _tw.classList.add('visible');
        var primarySrc = (song.provider || song.source || '').toLowerCase() || 'wy';
        var primaryId = song.songmid || song.mid || song.id || '';
        var activeSrc = lxSourceCache ? lxSourceCache.find(function(s) { return typeof fx !== 'undefined' && fx && s.id === fx.lxActiveSourceId; }) : null;
        var allSources = activeSrc && activeSrc.sources && activeSrc.sources.length ? activeSrc.sources : ['wy'];
        // 按顺序排列：主源优先，然后其他源
        var sourcesToTry = [primarySrc];
        for (var ai = 0; ai < allSources.length; ai++) {
          if (allSources[ai] !== primarySrc) sourcesToTry.push(allSources[ai]);
        }
        var lxLoadOverlay = document.getElementById('loading-overlay');
        if (lxLoadOverlay) lxLoadOverlay.classList.add('show');
        var rawQuality = typeof getProviderPlaybackQuality === 'function' ? getProviderPlaybackQuality('netease') : 'exhigh';
        var lxData = null;
        for (var si = 0; si < sourcesToTry.length; si++) {
          var trySrc = sourcesToTry[si];
          var tryId = trySrc === primarySrc ? primaryId : '';
          var trySong = trySrc === primarySrc ? song : null;
          // 非主源：先搜索获取该平台的歌曲 ID
          if (!tryId) {
            var searchQ = encodeURIComponent((song.name || '').trim() + ' ' + (song.artist || song.singer || '').trim());
            var searchUrl = '/api/lx/search?keywords=' + searchQ + '&source=' + encodeURIComponent(trySrc) + '&limit=3';
            try {
              var searchResult = typeof apiJson === 'function' ? await apiJson(searchUrl, { timeoutMs: 8000 }) : null;
              if (searchResult && searchResult.songs && searchResult.songs.length) {
                // 找最佳匹配（歌名完全相同优先）
                var targetName = (song.name || '').toLowerCase().trim();
                var bestMatch = null;
                for (var ri = 0; ri < searchResult.songs.length; ri++) {
                  var rs = searchResult.songs[ri];
                  if (!rs || !rs.id) continue;
                  var rsName = (rs.name || '').toLowerCase().trim();
                  if (rsName === targetName) { bestMatch = rs; break; }
                  if (!bestMatch && rsName.indexOf(targetName) >= 0) bestMatch = rs;
                  if (!bestMatch && targetName.indexOf(rsName) >= 0) bestMatch = rs;
                }
                if (!bestMatch) bestMatch = searchResult.songs[0];
                if (bestMatch) {
                  tryId = bestMatch.songmid || bestMatch.mid || bestMatch.id || '';
                  trySong = bestMatch;
                }
              }
            } catch(e) { /* search failed, skip this source */ }
          }
          if (!tryId) continue;
          // 构建 URL 并请求
          var tryUrl = '/api/lx/song/url?source=' + encodeURIComponent(trySrc) + '&songId=' + encodeURIComponent(tryId) + '&quality=' + encodeURIComponent(rawQuality);
          if (trySong) {
            var tryHash = trySong.hash || trySong.copyrightId || '';
            if (tryHash && tryHash !== tryId) tryUrl += '&hash=' + encodeURIComponent(tryHash);
            if (trySong.copyrightId && trySong.copyrightId !== tryHash) tryUrl += '&copyrightId=' + encodeURIComponent(trySong.copyrightId);
            if (trySong.name) tryUrl += '&name=' + encodeURIComponent(trySong.name);
            if (trySong.artist || trySong.singer) tryUrl += '&singer=' + encodeURIComponent(trySong.artist || trySong.singer || '');
            if (trySong.interval) tryUrl += '&interval=' + encodeURIComponent(trySong.interval);
            if (trySong.album) tryUrl += '&album=' + encodeURIComponent(trySong.album || '');
            if (trySong.img || trySong.cover) tryUrl += '&img=' + encodeURIComponent(trySong.img || trySong.cover || '');
          } else {
            if (song.name) tryUrl += '&name=' + encodeURIComponent(song.name);
            if (song.artist || song.singer) tryUrl += '&singer=' + encodeURIComponent(song.artist || song.singer || '');
          }
          try {
            lxData = typeof apiJson === 'function' ? await apiJson(tryUrl, { timeoutMs: 10000 }) : null;
            if (lxData && lxData.url) {
              lxData.provider = trySrc;
              break;
            }
          } catch (e) {
            console.warn('[LX] source ' + trySrc + ' failed:', e.message || e);
          }
        }
        if (lxData && lxData.url) {
          opts = Object.assign({}, opts, { preResolvedPlaybackData: lxData });
        }
      }
      // 无论是否 LX 歌曲，始终调用原始播放逻辑
      var lxResult = await _origPlayQueueAt(idx, opts);
      // 音频开始播放后立即隐藏 overlay；兜底 8 秒超时
      if (lxLoadOverlay) {
        var hideLxOverlay = function() {
          try { lxLoadOverlay.classList.remove('show'); } catch(e) {}
        };
        if (typeof audio !== 'undefined' && audio) {
          if (!audio.paused && !audio.ended && audio.src) {
            hideLxOverlay();
          } else {
            audio.addEventListener('playing', hideLxOverlay, { once: true });
            audio.addEventListener('error', hideLxOverlay, { once: true });
          }
        }
        setTimeout(hideLxOverlay, 8000);
      }
      return lxResult;
    };
    }
  doPatch();
})();

// LX 自动换源实现
async function tryLxSourceFallback(song, idx, token, opts) {
  opts = opts || {};
  if (opts.fallbackDepth > 0) {
    if (typeof skipFailedQueueItem === 'function') skipFailedQueueItem(idx, token, 'LX 自动换源后的版本仍不可播，播放下一首。');
    return true;
    }
  var currentSrc = (song.provider || song.source || '').toLowerCase();
  var activeSrc = lxSourceCache ? lxSourceCache.find(function(s) { return typeof fx !== 'undefined' && fx && s.id === fx.lxActiveSourceId; }) : null;
  var altSources = activeSrc && activeSrc.sources ? activeSrc.sources.filter(function(s) { return s !== currentSrc; }) : [];
  if (!altSources.length) {
    if (typeof skipFailedQueueItem === 'function') skipFailedQueueItem(idx, token, '当前 LX 源无其他平台可选，播放下一首。');
    return true;
    }
  var query = (song.name || '').trim() + ' ' + (song.artist || song.singer || '').trim();
  var fromLabel = typeof playbackProviderLabel === 'function' ? (playbackProviderLabel(song) || currentSrc).toUpperCase() : currentSrc.toUpperCase();
  if (typeof showSourceFallbackNotice === 'function') showSourceFallbackNotice('正在自动换源', fromLabel + ' 当前不可播，正在 LX 源中查找。');
  try {
    var searchFn = function(src) {
      var url = '/api/lx/search?keywords=' + encodeURIComponent(query) + '&source=' + encodeURIComponent(src) + '&limit=5';
      return (typeof apiJson === 'function' ? apiJson(url) : fetch(url).then(function(r){ return r.json(); }))
        .then(function(r) { return { src: src, songs: r.songs || [] }; })
        .catch(function() { return { src: src, songs: [] }; });
    };
    var allResults = await Promise.all(altSources.map(searchFn));
    if (typeof trackSwitchToken !== 'undefined' && token !== trackSwitchToken) return true;
    var bestMatch = null, bestSrc = null;
    var songName = (song.name || '').toLowerCase().trim();
    for (var i = 0; i < allResults.length; i++) {
      var res = allResults[i];
      for (var j = 0; j < res.songs.length; j++) {
        var s = res.songs[j];
        if (!s || !s.id) continue;
        var sName = (s.name || '').toLowerCase().trim();
        if (sName === songName || sName.indexOf(songName) >= 0 || songName.indexOf(sName) >= 0) {
          bestMatch = s; bestSrc = res.src; break;
          }
          }
      if (bestMatch) break;
      }
    if (!bestMatch) {
      if (typeof skipFailedQueueItem === 'function') skipFailedQueueItem(idx, token, '没有找到同名同歌手的 LX 其他源版本，播放下一首。');
      return true;
      }
    bestMatch = normalizeLxSearchSong(bestMatch);
    if (!bestMatch || !bestMatch.id) {
      if (typeof skipFailedQueueItem === 'function') skipFailedQueueItem(idx, token, '没有找到同名同歌手的 LX 其他源版本，播放下一首。');
      return true;
      }
    var fbUrl = '/api/lx/song/url?source=' + encodeURIComponent(bestSrc) + '&songId=' + encodeURIComponent(bestMatch.songmid || bestMatch.id) + '&quality=320k';
    var fbHash = bestMatch.hash || '';
    if (fbHash && fbHash !== (bestMatch.songmid || bestMatch.id)) fbUrl += '&hash=' + encodeURIComponent(fbHash);
    if (bestMatch.name) fbUrl += '&name=' + encodeURIComponent(bestMatch.name);
    if (bestMatch.artist || bestMatch.singer) fbUrl += '&singer=' + encodeURIComponent(bestMatch.artist || bestMatch.singer || '');
    if (bestMatch.interval) fbUrl += '&interval=' + encodeURIComponent(bestMatch.interval);
    var urlData = typeof apiJson === 'function' ? await apiJson(fbUrl) : await fetch(fbUrl).then(function(r){ return r.json(); });
    if (typeof trackSwitchToken !== 'undefined' && token !== trackSwitchToken) return true;
    if (urlData && urlData.url) {
      var fullAudioUrl = '/api/audio?url=' + encodeURIComponent(urlData.url);
      bestMatch.autoFallbackFrom = currentSrc;
      bestMatch._lxFallbackAudioUrl = fullAudioUrl;
      if (typeof playQueue !== 'undefined') playQueue[idx] = bestMatch;
      if (typeof hydrateCustomCover === 'function') playQueue[idx] = hydrateCustomCover(bestMatch);
      if (typeof safeRenderQueuePanel === 'function') safeRenderQueuePanel('lx-fallback', { scrollCurrent: typeof miniQueueOpen !== 'undefined' ? miniQueueOpen : false });
      if (typeof safeShelfRebuild === 'function') safeShelfRebuild('lx-fallback');
      if (typeof showSourceFallbackNotice === 'function') showSourceFallbackNotice('已自动切换音源', (song.name || '当前歌曲') + ' 已从 ' + fromLabel + ' 切到 ' + bestSrc.toUpperCase() + '。');
      if (typeof playQueueAt === 'function') await playQueueAt(idx, { fallbackDepth: 1, lxFallbackUrl: fullAudioUrl });
      return true;
      }
  } catch (e) {
    console.error('[lx fallback] error:', e.message);
    if (typeof trackSwitchToken !== 'undefined' && token !== trackSwitchToken) return true;
    }
  if (typeof skipFailedQueueItem === 'function') skipFailedQueueItem(idx, token, '没有找到同名同歌手的 LX 其他源版本，播放下一首。');
  return true;
  }

// --- 启动时初始化 ---
(function lxInit() {
  function init() {
    if (typeof fxDefaults === 'undefined' || typeof updateLxUI !== 'function') {
      setTimeout(init, 200);
      return;
      }
    if (!('lxSourceEnabled' in fxDefaults)) fxDefaults.lxSourceEnabled = false;
    if (!('lxActiveSourceId' in fxDefaults)) fxDefaults.lxActiveSourceId = null;
    if (typeof fx !== 'undefined' && fx) {
      if (!('lxSourceEnabled' in fx)) fx.lxSourceEnabled = false;
      if (!('lxActiveSourceId' in fx)) fx.lxActiveSourceId = null;
      }
    // 先注入 HTML，再加载 UI
    setTimeout(function() {
      addLxHtmlElements();
      setTimeout(function() {
        updateLxUI();
      }, 300);
    }, 100);
    }
  init();
})();

// DOMContentLoaded 安全网：仅在 HTML 尚未注入时注入
(function lxDomInit() {
  document.addEventListener('DOMContentLoaded', function() {
    setTimeout(function() {
      if (!document.getElementById('lx-mode-seg')) {
        addLxHtmlElements();
        }
      // 绑定 LX 模式按钮事件
      var modeSeg = document.getElementById('lx-mode-seg');
      if (modeSeg) {
        modeSeg.querySelectorAll('button').forEach(function(b) {
          if (!b._lxBound) {
            b._lxBound = true;
            b.addEventListener('click', function() {
              setLxMode(b.dataset.lxMode);
            });
            }
        });
        }
    }, 50);
  });
})();

// 动态添加 LX 所需的 HTML 元素
function addLxHtmlElements() {
  // 添加 LX 搜索模式按钮容器
  var tabs = document.getElementById('search-mode-tabs');
  if (tabs && !document.getElementById('lx-search-mode-btns')) {
    var lxSpan = document.createElement('span');
    lxSpan.id = 'lx-search-mode-btns';
    lxSpan.style.display = 'none';
    tabs.appendChild(lxSpan);
    }

  // 添加 LX 源管理区域到 FX 面板
  var fxPanel = document.getElementById('fx-panel');
  if (fxPanel && !document.getElementById('lx-mode-seg')) {
    var lxHtml = '' +
      // 获取模式切换
      '<div class="fx-seg" id="lx-mode-seg">' +
        '<button data-lx-mode="default" class="active">默认</button>' +
        '<button data-lx-mode="lx">LX 源</button>' +
      '</div>' +
      // 活跃源选择区域
      '<div id="lx-active-source-section" style="display:none">' +
        '<div class="fx-section-label">活跃源</div>' +
        '<div class="fx-seg" id="lx-active-source-seg"></div>' +
      '</div>' +
      // 源管理按钮
      '<div class="lx-source-actions" id="lx-source-actions">' +
        '<button class="fx-mini-btn" id="lx-import-btn" onclick="showLxImportInput()">+ 导入在线源</button>' +
        '<button class="fx-mini-btn" id="lx-import-local-btn" onclick="showLxLocalImportInput()">+ 导入本地源</button>' +
      '</div>' +
      // 导入在线源输入行
      '<div id="lx-import-row" style="display:none;gap:5px;margin-bottom:6px">' +
        '<input id="lx-import-url" type="text" placeholder="输入 LX 源脚本 URL..." style="flex:1;padding:5px 8px;border-radius:7px;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.25);color:#fff;font-size:11px;font-family:inherit;outline:none">' +
        '<button class="fx-mini-btn" id="lx-import-confirm" onclick="doLxImport()">确认</button>' +
        '<button class="fx-mini-btn" id="lx-import-cancel" onclick="hideLxImportInput()">取消</button>' +
      '</div>' +
      // 导入本地源输入行
      '<div id="lx-import-local-row" style="display:none;gap:5px;margin-bottom:6px">' +
        '<input id="lx-import-local-path" type="text" placeholder="输入本地 .js 源文件路径..." style="flex:1;padding:5px 8px;border-radius:7px;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.25);color:#fff;font-size:11px;font-family:inherit;outline:none">' +
        '<button class="fx-mini-btn" id="lx-import-local-confirm" onclick="doLxLocalImport()">确认</button>' +
        '<button class="fx-mini-btn" id="lx-import-local-cancel" onclick="hideLxLocalImportInput()">取消</button>' +
      '</div>' +
      // 源列表
      '<div id="lx-source-list" class="lx-source-list"></div>' +
      // 状态栏
      '<div id="lx-status-bar" class="lx-status">' +
        '<span id="lx-status-dot" class="lx-status-dot off"></span>' +
        '<span id="lx-status-text">未启用 LX 源</span>' +
      '</div>';

    var temp = document.createElement('div');
    temp.innerHTML = lxHtml;
    // 注入到 fx-panel 末尾（console workspace 会重新组织到「系统」→「获取模式」折叠卡片中）
    while (temp.firstChild) {
      fxPanel.appendChild(temp.firstChild);
      }

    // 为 LX 模式切换按钮绑定事件（使用 _lxBound 避免重复绑定）
    setTimeout(function() {
      var modeSeg = document.getElementById('lx-mode-seg');
      if (modeSeg) {
        modeSeg.querySelectorAll('button').forEach(function(b) {
          if (!b._lxBound) {
            b._lxBound = true;
            b.addEventListener('click', function() {
              setLxMode(b.dataset.lxMode);
            });
            }
        });
        }
    }, 100);
    }

  // 确保 collect-modal 存在
  if (!document.getElementById('collect-modal')) {
    var modalHtml = '<div id="collect-modal" class="modal-mask"><div class="modal collect-modal">' +
      '<h2>收藏到歌单</h2>' +
      '<div id="collect-current" class="collect-current"></div>' +
      '<div class="collect-create">' +
        '<input id="collect-new-name" type="text" placeholder="新建歌单名称" autocomplete="off" maxlength="40">' +
        '<button class="modal-btn primary" onclick="createPlaylistFromCollect()">创建</button>' +
      '</div>' +
      '<div id="collect-list" class="collect-list"></div>' +
      '<div class="btn-row">' +
        '<button class="modal-btn" onclick="closeCollectModal()">关闭</button>' +
      '</div>' +
    '</div></div>';
    var temp3 = document.createElement('div');
    temp3.innerHTML = modalHtml;
    document.body.appendChild(temp3.firstChild);
    }
    }

// 同步注入 LX HTML 元素（必须在 organizeFxConsoleWorkspace 之前执行，以便被正确组织到「系统」→「获取模式」卡片中）
addLxHtmlElements();

// --- 禁用启动时自动弹出登录框（快速轮询，减少竞态窗口）---
(function disableAutoLoginPopup() {
  function doPatch(attempt) {
    attempt = (attempt || 0) + 1;
    if (typeof maybeRunStartupLoginGuide !== 'function') {
      if (attempt > 50) return; // 5 秒后放弃
      setTimeout(function() { doPatch(attempt); }, attempt <= 5 ? 10 : 100);
      return;
    }
    maybeRunStartupLoginGuide = function() {};
  }
  doPatch();
})();

// --- LX 模式下抑制登录弹窗：showLoginModal → toast 提示 ---
(function suppressLoginModalInLx() {
  function doPatch(attempt) {
    attempt = (attempt || 0) + 1;
    if (typeof showLoginModal !== 'function') {
      if (attempt > 50) return;
      setTimeout(function() { doPatch(attempt); }, attempt <= 5 ? 10 : 100);
      return;
    }
    var _origShowLoginModal = showLoginModal;
    showLoginModal = function(opts) {
      if (typeof fx !== 'undefined' && fx && fx.lxSourceEnabled) {
        // LX 模式下静默跳过登录弹窗，不显示任何 toast 避免干扰启动画面
        return;
      }
      return _origShowLoginModal(opts);
    };
  }
  doPatch();
})();
