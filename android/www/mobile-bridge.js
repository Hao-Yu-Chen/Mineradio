/**
 * Mineradio Mobile Bridge — stable version
 */
(function() {
  'use strict';
  var noop = function() {};
  var asyncNoop = async function() { return {}; };
  var S = 'http://127.0.0.1:3000';

  // ── API routing (fetch + XHR + Audio) ──
  (function() {
    var _f = window.fetch;
    window.fetch = function(u, o) {
      if (typeof u === 'string' && (u.startsWith('/api/') || u.startsWith('/vendor/')))
        u = S + u;
      return _f.call(window, u, o);
    };
    var _x = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(m, u, a, us, p) {
      if (typeof u === 'string' && (u.startsWith('/api/') || u.startsWith('/vendor/')))
        u = S + u;
      return _x.call(this, m, u, a !== false, us, p);
    };
    // Patch Audio src to also route through server
    var _audioSrcDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
    if (_audioSrcDesc && _audioSrcDesc.set) {
      var _origSet = _audioSrcDesc.set;
      Object.defineProperty(HTMLMediaElement.prototype, 'src', {
        get: _audioSrcDesc.get,
        set: function(v) {
          if (typeof v === 'string' && v.startsWith('/api/'))
            v = S + v;
          _origSet.call(this, v);
        },
        configurable: true
      });
    }
    // Patch Image src for cover loading (3D shelf, playback thumb etc.)
    // These use new Image() with relative /api/ URLs which bypass fetch/XHR.
    var _imgSrcDesc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    if (_imgSrcDesc && _imgSrcDesc.set) {
      var _imgOrigSet = _imgSrcDesc.set;
      Object.defineProperty(HTMLImageElement.prototype, 'src', {
        get: _imgSrcDesc.get,
        set: function(v) {
          if (typeof v === 'string' && v.startsWith('/api/'))
            v = S + v;
          _imgOrigSet.call(this, v);
        },
        configurable: true
      });
    }
  })();

  // ── desktopWindow shim ──
  window.desktopWindow = {
    isDesktop: false, isMobile: true,
    minimize: asyncNoop, toggleMaximize: asyncNoop,
    toggleFullscreen: async function() { try { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(); } catch(e) {} },
    exitFullscreenWindowed: async function() { try { document.exitFullscreen(); } catch(e) {} },
    getState: async function() { return { isMaximized:false, isFullscreen:!!document.fullscreenElement, isFocused:true, isVisible:true }; },
    close: noop,
    openNeteaseMusicLogin: async function() { return { ok: false, reason: 'use_qr_login' }; },
    clearNeteaseMusicLogin: asyncNoop,
    openQQMusicLogin: async function() { return { ok: false, reason: 'use_qr_login' }; },
    clearQQMusicLogin: asyncNoop,
    exportJsonFile: async function(p) {
      var d = p && p.data ? p.data : p; var n = (p && p.name) || 'mineradio-export';
      var b = new Blob([JSON.stringify(d,null,2)],{type:'application/json'});
      var u = URL.createObjectURL(b); var a = document.createElement('a');
      a.href=u; a.download=n+'.json'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(u);
      return {ok:true};
    },
    importJsonFile: async function() {
      return new Promise(function(r) {
        var i = document.createElement('input'); i.type='file'; i.accept='.json';
        i.onchange = function() { var f=i.files[0]; if(!f){r({ok:false});return;} var fr=new FileReader(); fr.onload=function(){try{r({ok:true,data:JSON.parse(fr.result)})}catch(e){r({ok:false})}}; fr.readAsText(f); };
        i.click();
      });
    },
    openUpdateInstaller: asyncNoop, restartApp: asyncNoop,
    configureGlobalHotkeys: async function() { return {ok:true,results:[]}; },
    onGlobalHotkey: function() { return noop; },
    setDesktopLyricsEnabled: asyncNoop, updateDesktopLyrics: asyncNoop,
    onDesktopLyricsLockState: function() { return noop; },
    onDesktopLyricsEnabledState: function() { return noop; },
    setWallpaperMode: asyncNoop, updateWallpaperMode: asyncNoop,
    onStateChange: function(cb) { if(typeof cb==='function') cb({isFocused:true,isVisible:true,isMaximized:false,isFullscreen:false}); return noop; },
  };

  var _statusServer = '...';
  var _statusCanvas = '';
  var _statusFailAt = 0;
  var _lxUiRetried = false;
  var _loginRetried = false;

  function showStatus(msg, color) {
    var el = document.getElementById('_m_status');
    if (!el) {
      el = document.createElement('div');
      el.id = '_m_status';
      el.style.cssText = 'position:fixed;z-index:99999;top:8px;left:50%;transform:translateX(-50%);padding:4px 14px;border-radius:20px;font-size:10px;font-family:monospace;pointer-events:none;background:rgba(0,0,0,.85);color:#0f0;border:1px solid rgba(255,255,255,.15);line-height:1.4;text-align:center;';
      document.body && document.body.appendChild(el);
    }
    el.style.color = color || '#0f0';
    el.innerHTML = _statusServer + '<br>' + _statusCanvas;
    el.style.display = msg === '__hide__' ? 'none' : '';
    return el;
  }

  // ── Server health check ──
  var _bootToastShown = false;
  function check() {
    fetch(S + '/api/app/version').then(function(r) { return r.json(); }).then(function(d) {
      var wasDown = _statusFailAt > 0;
      _statusServer = 'SVR: v' + d.version + ' OK';
      _statusFailAt = 0;
      showStatus('__hide__', '#0f0');
      // Show boot error as toast once on first successful health check
      if (!_bootToastShown && d.bootError) {
        _bootToastShown = true;
        var msg = '[BOOT ERROR] ' + d.bootError;
        console.error(msg);
        if (typeof showToast === 'function') showToast(msg.substring(0, 200));
        if (typeof showSourceFallbackNotice === 'function') showSourceFallbackNotice('BOOT ERROR', d.bootError);
      }
      // On Android cold start, updateLxUI() runs before the Node.js server is
      // ready, so imported LX sources don't appear until the user toggles mode.
      // Retry once after the server becomes available.
      if (!_lxUiRetried && typeof updateLxUI === 'function') {
        _lxUiRetried = true;
        updateLxUI();
      }
      // Retry login status checks after server comes online (cold start ~6s delay)
      if (!_loginRetried && typeof refreshLoginStatus === 'function') {
        _loginRetried = true;
        try { refreshLoginStatus(true); } catch (ignored) {}
        try { if (typeof refreshQQLoginStatus === 'function') refreshQQLoginStatus(true); } catch (ignored) {}
        try { if (typeof refreshKugouLoginStatus === 'function') refreshKugouLoginStatus(true); } catch (ignored) {}
        try { if (typeof refreshQishuiLoginStatus === 'function') refreshQishuiLoginStatus(true); } catch (ignored) {}
        try { if (typeof refreshSpotifyLoginStatus === 'function') refreshSpotifyLoginStatus(true); } catch (ignored) {}
      }
    }).catch(function(e) {
      if (!_statusFailAt) _statusFailAt = Date.now();
      if (Date.now() - _statusFailAt > 30000) {
        _statusServer = 'SVR: DOWN';
        showStatus('', '#f33');
      }
    });
  }
  check();
  setInterval(check, 5000);

  // ── CSS fix (backdrop-filter white blocks) ──
  function fixStyles() {
    var sel = '#home-btn,#upload-btn,#fx-fab,#user-btn,#visual-guide-btn,#play-btn,#pause-btn,.ctrl-btn,#top-right .icon-btn,.glass-saved-button,#search-box,#fx-fab-hide-btn,#user-capsule-hide-btn,#_m_search_hide,#_m_topright_hide';
    var els = document.querySelectorAll(sel);
    els.forEach(function(el) {
      el.style.setProperty('backdrop-filter', 'none', 'important');
      el.style.setProperty('-webkit-backdrop-filter', 'none', 'important');
      el.style.setProperty('background', 'rgba(8,9,11,.86)', 'important');
      el.style.setProperty('border-color', 'rgba(255,255,255,.10)', 'important');
    });
    var pb = document.getElementById('play-btn');
    if (pb) pb.style.setProperty('box-shadow', '0 4px 20px rgba(0,0,0,.25)', 'important');
    var uc = document.getElementById('user-capsule-hide-btn');
    if (uc) uc.style.display = 'none';
  }

  // ── Android: 搜索栏自动隐藏开关 ──
  var SEARCH_AUTO_HIDE_KEY = 'mineradio-search-auto-hide-v1';
  var TOP_RIGHT_AUTO_HIDE_KEY = 'mineradio-top-right-auto-hide-v1';
  var searchAutoHide = true;
  var topRightAutoHide = false;
  try {
    var _sah = localStorage.getItem(SEARCH_AUTO_HIDE_KEY);
    if (_sah !== null) searchAutoHide = _sah === 'true' || _sah === '1';
    var _trah = localStorage.getItem(TOP_RIGHT_AUTO_HIDE_KEY);
    if (_trah !== null) topRightAutoHide = _trah === 'true' || _trah === '1';
  } catch(e) {}

  function injectSearchHideBtn() {
    var controlsHideBtn = document.getElementById('controls-hide-btn');
    if (!controlsHideBtn || document.getElementById('_m_search_hide')) return;
    var b = document.createElement('button');
    b.id = '_m_search_hide';
    b.className = 'ctrl-btn' + (searchAutoHide ? ' active' : '');
    b.title = searchAutoHide ? '搜索栏自动隐藏：开' : '搜索栏自动隐藏：关';
    b.innerHTML = '<svg width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/></svg>';
    b.style.cssText = 'backdrop-filter:none;-webkit-backdrop-filter:none;background:rgba(8,9,11,.86);border-color:rgba(255,255,255,.10);';
    b.addEventListener('pointerdown', function(e) {
      e.preventDefault(); e.stopPropagation();
      searchAutoHide = !searchAutoHide;
      try { localStorage.setItem(SEARCH_AUTO_HIDE_KEY, searchAutoHide ? '1' : '0'); } catch(ex) {}
      b.classList.toggle('active', searchAutoHide);
      b.title = searchAutoHide ? '搜索栏自动隐藏：开' : '搜索栏自动隐藏：关';
      document.body.classList.toggle('search-auto-hide-disabled', !searchAutoHide);
      if (typeof showToast === 'function') showToast(searchAutoHide ? '搜索栏自动隐藏已开启' : '搜索栏已固定显示');
    });
    controlsHideBtn.parentNode.insertBefore(b, controlsHideBtn);
  }

  function injectTopRightHideBtn() {
    var controlsHideBtn = document.getElementById('controls-hide-btn');
    if (!controlsHideBtn || document.getElementById('_m_topright_hide')) return;
    var b = document.createElement('button');
    b.id = '_m_topright_hide';
    b.className = 'ctrl-btn' + (topRightAutoHide ? ' active' : '');
    b.title = topRightAutoHide ? 'Home/DIY/登录自动隐藏：开' : 'Home/DIY/登录自动隐藏：关';
    b.innerHTML = '<svg width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path d="M3 10.8 12 3l9 7.8"/><path d="M5 10v10h14V10"/></svg>';
    b.style.cssText = 'backdrop-filter:none;-webkit-backdrop-filter:none;background:rgba(8,9,11,.86);border-color:rgba(255,255,255,.10);';
    b.addEventListener('pointerdown', function(e) {
      e.preventDefault(); e.stopPropagation();
      topRightAutoHide = !topRightAutoHide;
      try { localStorage.setItem(TOP_RIGHT_AUTO_HIDE_KEY, topRightAutoHide ? '1' : '0'); } catch(ex) {}
      b.classList.toggle('active', topRightAutoHide);
      b.title = topRightAutoHide ? 'Home/DIY/登录自动隐藏：开' : 'Home/DIY/登录自动隐藏：关';
      applyTopRightAutoHide();
      if (typeof showToast === 'function') showToast(topRightAutoHide ? 'Home/DIY/登录按钮已自动隐藏' : 'Home/DIY/登录按钮已固定显示');
    });
    controlsHideBtn.parentNode.insertBefore(b, controlsHideBtn);
  }

  function applySearchAutoHide() {
    document.body.classList.toggle('search-auto-hide-disabled', !searchAutoHide);
    // 指针移动处理：searchAutoHide 关闭时搜索栏始终可见
    var style = document.getElementById('_m_search_hide_css');
    if (!style) {
      style = document.createElement('style');
      style.id = '_m_search_hide_css';
      document.head.appendChild(style);
    }
    style.textContent = 'body.search-auto-hide-disabled #search-area{top:24px;opacity:1;pointer-events:auto}' +
      'body.search-auto-hide-disabled #search-area.stage-mode{top:18px}';
  }

  function applyTopRightAutoHide() {
    // 复用 userCapsuleAutoHide 机制控制 Home/DIY/登录按钮的显示
    if (typeof userCapsuleAutoHide !== 'undefined') {
      userCapsuleAutoHide = topRightAutoHide;
    }
    if (typeof applyUserCapsuleAutoHideState === 'function') {
      applyUserCapsuleAutoHideState();
    }
  }

  // 补丁指针移动：searchAutoHide 关闭时搜索栏常显
  function patchSearchPeek() {
    var check = function() {
      if (!searchAutoHide && typeof setPeek === 'function') {
        var sa = document.getElementById('search-area');
        if (sa) setPeek(sa, true, 'search');
      }
    };
    // 在 DOM 准备好后补丁
    var origMousemove = window.onmousemove;
    document.addEventListener('pointermove', function(e) {
      if (!searchAutoHide) {
        var sa = document.getElementById('search-area');
        if (sa && typeof setPeek === 'function') setPeek(sa, true, 'search');
      }
    }, { passive: true });
    setTimeout(check, 500);
    setTimeout(check, 2000);
  }

  // ── DIY button ──
  function addDiy() {
    var home = document.getElementById('home-btn');
    if (!home || document.getElementById('_m_diy')) return;
    var b = document.createElement('button');
    b.id = '_m_diy'; b.title = 'DIY';
    b.innerHTML = '<svg width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.9" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 1v4"/><path d="M12 19v4"/><path d="M4.2 4.2l2.8 2.8"/><path d="M17 17l2.8 2.8"/><path d="M1 12h4"/><path d="M19 12h4"/><path d="M4.2 19.8l2.8-2.8"/><path d="M17 7l2.8-2.8"/></svg>';
    b.className = 'icon-btn';
    b.style.cssText = 'width:44px;min-width:44px;height:44px;border:1px solid rgba(255,255,255,.10);border-radius:50%;background:rgba(8,9,11,.86);color:rgba(232,236,239,.78);cursor:pointer;display:flex;align-items:center;justify-content:center;backdrop-filter:none;-webkit-backdrop-filter:none;';
    b.addEventListener('pointerdown', function(e) {
      e.preventDefault(); e.stopPropagation();
      if (typeof applyDiyMode === 'function') applyDiyMode(true, { save: true });
      if (typeof toggleFxPanel === 'function') setTimeout(function() { toggleFxPanel(true); }, 200);
    });
    home.parentNode.insertBefore(b, home.nextSibling);
    b.style.setProperty('backdrop-filter','none','important');
    b.style.setProperty('-webkit-backdrop-filter','none','important');
    b.style.setProperty('background','rgba(8,9,11,.86)','important');
  }

  // ── Fix: make particle canvas visible on mobile ──
  function fixParticles() {
    var container = document.getElementById('canvas-container');
    if (container) {
      container.style.setProperty('display', 'block', 'important');
      container.style.setProperty('opacity', '1', 'important');
      container.style.setProperty('visibility', 'visible', 'important');
      container.style.setProperty('z-index', '1', 'important');
    }
    var canvas = document.querySelector('#canvas-container canvas');
    if (canvas) {
      canvas.style.setProperty('display', 'block', 'important');
      canvas.style.setProperty('opacity', '1', 'important');
      canvas.style.setProperty('visibility', 'visible', 'important');
    }
    // Remove deep-sleep class that hides canvas
    document.body && document.body.classList.remove('render-deep-sleep');
  }

  // ── Fix: enable DIY mode on first launch ──
  function autoEnableDiy() {
    try {
      if (!localStorage.getItem('mineradio-diy-player-mode-v1')) {
        localStorage.setItem('mineradio-diy-player-mode-v1', '1');
      }
    } catch(e) {}
  }
  autoEnableDiy();

  // ── Init ──
  function run() {
    if (!document.body) return;
    document.documentElement.classList.add('mobile-shell');
    document.body.classList.add('mobile-app');
    fixStyles();
    addDiy();
    applySearchAutoHide();
    applyTopRightAutoHide();
    injectSearchHideBtn();
    injectTopRightHideBtn();
    patchSearchPeek();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
  setTimeout(run, 1000);
  setTimeout(run, 2000);
  setTimeout(fixParticles, 3000);
  setTimeout(fixParticles, 6000);
})();
