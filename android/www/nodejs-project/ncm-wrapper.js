// ncm-wrapper.js — Lazy-loading NeteaseCloudMusicApi wrapper
// Bypasses main.js which triggers native crash on Android 16 nodejs-mobile.
// Each function is lazily loaded on first call to avoid bulk require().

var path = require('path');
var modDir = path.join(__dirname, 'node_modules', 'NeteaseCloudMusicApi', 'module');
var requestMod = null;

function getRequest() {
    if (!requestMod) requestMod = require(path.join(__dirname, 'node_modules', 'NeteaseCloudMusicApi', 'util', 'request'));
    return requestMod;
}

// Simple cookie string→object
function cookieToJson(c) {
    if (!c) return {};
    var o = {};
    String(c).split(';').forEach(function(i) {
        var a = i.split('='), k = (a[0]||'').trim();
        if (k) o[k] = (a[1]||'').trim();
    });
    return o;
}

function makeLazy(name) {
    var filePath = path.join(modDir, name + '.js');
    var cachedMod = null;
    return function (data) {
        if (data === undefined) data = {};
        if (!cachedMod) cachedMod = require(filePath);
        if (typeof data.cookie === 'string') data.cookie = cookieToJson(data.cookie);
        return cachedMod(
            { cookie: data.cookie ? data.cookie : {} },
            getRequest()
        );
    };
}

// All functions used by server.js — loaded lazily
module.exports = {
    search: makeLazy('search'),
    cloudsearch: makeLazy('cloudsearch'),
    song_detail: makeLazy('song_detail'),
    song_url: makeLazy('song_url'),
    song_url_v1: makeLazy('song_url_v1'),
    login_qr_key: makeLazy('login_qr_key'),
    login_qr_create: makeLazy('login_qr_create'),
    login_qr_check: makeLazy('login_qr_check'),
    login_status: makeLazy('login_status'),
    logout: makeLazy('logout'),
    user_account: makeLazy('user_account'),
    user_playlist: makeLazy('user_playlist'),
    comment_music: makeLazy('comment_music'),
    artist_detail: makeLazy('artist_detail'),
    artist_top_song: makeLazy('artist_top_song'),
    artist_songs: makeLazy('artist_songs'),
    like: makeLazy('like'),
    likelist: makeLazy('likelist'),
    song_like_check: makeLazy('song_like_check'),
    playlist_tracks: makeLazy('playlist_tracks'),
    playlist_track_add: makeLazy('playlist_track_add'),
    playlist_create: makeLazy('playlist_create'),
    playlist_detail: makeLazy('playlist_detail'),
    playlist_track_all: makeLazy('playlist_track_all'),
    personalized: makeLazy('personalized'),
    recommend_resource: makeLazy('recommend_resource'),
    recommend_songs: makeLazy('recommend_songs'),
    dj_detail: makeLazy('dj_detail'),
    dj_program: makeLazy('dj_program'),
    dj_hot: makeLazy('dj_hot'),
    dj_sublist: makeLazy('dj_sublist'),
    user_audio: makeLazy('user_audio'),
    dj_paygift: makeLazy('dj_paygift'),
    record_recent_voice: makeLazy('record_recent_voice'),
    sati_resource_sub_list: makeLazy('sati_resource_sub_list'),
    lyric: makeLazy('lyric'),
    lyric_new: makeLazy('lyric_new'),
};
