function mineradioCacheStorageNode(id) {
  return document.getElementById(id);
}

function formatMineradioCacheBytes(value) {
  var bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return bytes + ' B';
  var units = ['KB', 'MB', 'GB', 'TB'];
  var index = -1;
  do {
    bytes /= 1024;
    index += 1;
  } while (bytes >= 1024 && index < units.length - 1);
  return (bytes >= 100 || index === 0 ? bytes.toFixed(0) : bytes.toFixed(1)) + ' ' + units[index];
}

function setMineradioCacheStorageText(id, value) {
  var node = mineradioCacheStorageNode(id);
  if (node) node.textContent = value == null || value === '' ? '—' : String(value);
}

function applyMineradioCacheSettings(snapshot) {
  if (!snapshot || !snapshot.ok) {
    setMineradioCacheStorageText('cache-storage-total', '读取失败');
    setMineradioCacheStorageText('cache-storage-note', snapshot && snapshot.error ? ('缓存设置不可用：' + snapshot.error) : '缓存设置不可用');
    return;
  }
  var settings = snapshot.settings || {};
  var usage = snapshot.usage || {};
  setMineradioCacheStorageText('cache-storage-root', settings.rootPath);
  setMineradioCacheStorageText('cache-storage-total', '已占用 ' + formatMineradioCacheBytes(usage.totalManagedBytes));
  setMineradioCacheStorageText('cache-storage-lyrics-path', settings.lyricsPath);
  setMineradioCacheStorageText('cache-storage-lyrics-size', formatMineradioCacheBytes(usage.lyricsBytes));
  setMineradioCacheStorageText('cache-storage-chromium-path', settings.activeChromiumPath || settings.chromiumPath);
  setMineradioCacheStorageText('cache-storage-chromium-size', formatMineradioCacheBytes(usage.chromiumBytes));
  setMineradioCacheStorageText('cache-storage-beatmaps-path', settings.activeBeatmapsPath || settings.beatmapsPath);
  setMineradioCacheStorageText('cache-storage-beatmaps-size', formatMineradioCacheBytes(usage.beatmapsBytes));
  setMineradioCacheStorageText('cache-storage-updates-path', settings.activeUpdatesPath || settings.updatesPath);
  setMineradioCacheStorageText('cache-storage-updates-size', formatMineradioCacheBytes(usage.updatesBytes));
  setMineradioCacheStorageText('cache-storage-wallpaper-path', settings.activeWallpaperEnginePath || settings.wallpaperEnginePath);
  setMineradioCacheStorageText('cache-storage-wallpaper-size', formatMineradioCacheBytes(usage.wallpaperEngineBytes));
  setMineradioCacheStorageText('cache-storage-userdata-path', settings.userDataPath || '系统安全数据目录');
  setMineradioCacheStorageText('cache-storage-userdata-size', formatMineradioCacheBytes(usage.userDataBytes));
  var restartButton = mineradioCacheStorageNode('cache-storage-restart');
  if (restartButton) restartButton.hidden = !settings.restartRequired;
  setMineradioCacheStorageText(
    'cache-storage-note',
    settings.restartRequired
      ? '歌词缓存已切换；封面、网络、音频分片、节奏分析、WE 静音场景与更新缓存将在重启后改用新目录。'
      : '歌词缓存立即生效；封面、网络、音频分片、节奏分析、WE 静音场景与更新缓存已使用此目录。'
  );
}

function refreshMineradioCacheSettings() {
  if (!window.desktopWindow || typeof window.desktopWindow.getCacheSettings !== 'function') {
    applyMineradioCacheSettings({ ok: false, error: '仅桌面版支持本地缓存路径设置' });
    return Promise.resolve();
  }
  setMineradioCacheStorageText('cache-storage-total', '正在统计...');
  return window.desktopWindow.getCacheSettings().then(applyMineradioCacheSettings).catch(function (error) {
    applyMineradioCacheSettings({ ok: false, error: error && error.message || '读取失败' });
  });
}

function chooseMineradioCacheRoot() {
  if (!window.desktopWindow || typeof window.desktopWindow.chooseCacheDirectory !== 'function') return;
  window.desktopWindow.chooseCacheDirectory().then(function (choice) {
    if (!choice || !choice.ok || choice.canceled || !choice.rootPath) return;
    return window.desktopWindow.setCacheSettings({ rootPath: choice.rootPath });
  }).then(function (snapshot) {
    if (snapshot) applyMineradioCacheSettings(snapshot);
  }).catch(function (error) {
    applyMineradioCacheSettings({ ok: false, error: error && error.message || '保存失败' });
  });
}

function restartMineradioForCachePath() {
  if (!window.desktopWindow || typeof window.desktopWindow.restartApp !== 'function') return;
  window.desktopWindow.restartApp();
}

// ── LX 音乐数据缓存管理 ──
function refreshLxCacheStats() {
  fetch('/api/lx/cache/stats').then(function(r) { return r.json(); }).then(function(s) {
    setMineradioCacheStorageText('cache-lx-url-count', s.url + ' 条');
    setMineradioCacheStorageText('cache-lx-lyric-count', s.lyric + ' 条');
    setMineradioCacheStorageText('cache-lx-cross-count', s.crossSource + ' 条');
    if (s.urlFailed > 0 || s.lyricFailed > 0 || s.crossFailed > 0) {
      var parts = [];
      if (s.urlFailed > 0) parts.push(s.urlFailed + ' 条脏 URL');
      if (s.lyricFailed > 0) parts.push(s.lyricFailed + ' 条脏歌词');
      if (s.crossFailed > 0) parts.push(s.crossFailed + ' 条脏跨源');
      if (typeof showToast === 'function') showToast('LX 缓存: ' + s.url + ' URL / ' + s.lyric + ' 歌词 / ' + s.crossSource + ' 跨源 (脏数据: ' + parts.join(', ') + ')');
    }
  }).catch(function() {
    setMineradioCacheStorageText('cache-lx-url-count', '离线');
    setMineradioCacheStorageText('cache-lx-lyric-count', '离线');
    setMineradioCacheStorageText('cache-lx-cross-count', '离线');
  });
}

function clearLxCache(type) {
  var labels = { url: 'URL 缓存', lyric: '歌词缓存', crossSource: '跨源搜索缓存', all: '全部 LX 缓存' };
  var label = labels[type] || type;
  fetch('/api/lx/cache/clear', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: type }) })
    .then(function(r) { return r.json(); }).then(function(d) {
      if (d.ok) {
        if (typeof showToast === 'function') showToast('已清除 ' + d.cleared + ' 条 ' + label);
      }
      refreshLxCacheStats();
    }).catch(function() {
      if (typeof showToast === 'function') showToast('清除 ' + label + ' 失败');
    });
}

setTimeout(refreshLxCacheStats, 600);
