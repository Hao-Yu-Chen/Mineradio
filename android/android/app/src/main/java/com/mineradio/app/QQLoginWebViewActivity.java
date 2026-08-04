package com.mineradio.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.graphics.Color;
import android.net.http.SslError;
import android.os.Bundle;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import org.json.JSONObject;

public class QQLoginWebViewActivity extends AppCompatActivity {

    private static final String T = "MINERADIO-QQLOGIN";
    // Match PC Electron QQ_LOGIN_URL: the profile page shows the login QR directly
    private static final String LOGIN_URL = "https://y.qq.com/n/ryqq/profile";
    private static final String WARMUP_URL = "https://y.qq.com/n/ryqq/player";
    // Same priority order as PC Electron QQ_LOGIN_COOKIE_PRIORITY
    private static final String[] COOKIE_PRIORITY = {
        "uin", "qqmusic_uin", "wxuin", "login_type",
        "qm_keyst", "qqmusic_key",
        "p_skey", "skey",
        "psrf_qqopenid", "psrf_qqunionid",
        "psrf_qqaccess_token", "psrf_qqrefresh_token",
        "wxopenid", "wxunionid", "wxrefresh_token", "wxskey",
        "p_uin", "ptcz", "RK",
    };
    private static final long POLL_INTERVAL_MS = 1500L;
    private static final long TIMEOUT_MS = 5 * 60 * 1000L; // 5 min
    private static final long WARMUP_RETRY_MS = 8000L;
    // Required markers
    private static final String[] UIN_KEYS = {"uin", "qqmusic_uin", "wxuin", "p_uin"};
    private static final String[] MUSIC_KEYS = {"qqmusic_key", "qm_keyst", "music_key", "p_skey", "skey",
        "psrf_qqaccess_token", "psrf_qqrefresh_token", "wxrefresh_token", "wxskey"};
    private static final String[] PLAYBACK_KEYS = {"qm_keyst", "qqmusic_key", "music_key", "wxskey"};

    private WebView webView;
    private Handler handler = new Handler(Looper.getMainLooper());
    private Runnable pollRunnable;
    private long startTime;
    private long lastWarmupTime = 0;
    private int warmupRetryCount = 0;
    private boolean loginDetected = false;
    private boolean warmupStarted = false;

    // ── Cookie DB paths to try (varies by Android version / WebView impl) ──
    private File[] getCookieDbPaths() {
        String dataDir = getApplicationContext().getApplicationInfo().dataDir;
        return new File[]{
            new File(dataDir, "app_webview/Default/Cookies"),
            new File(dataDir, "app_webview/Cookies"),
            new File(dataDir, "app_webview/WebViewSandbox/Cookies"),
            new File(dataDir, "app_webview/Profile 1/Cookies"),
            new File(dataDir, "databases/webviewCookiesChromium.db"),
            new File(dataDir, "databases/webviewCookiesChromium"),
        };
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Build UI: title bar + WebView
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setBackgroundColor(Color.parseColor("#1a1a1a"));
        bar.setPadding(32, 40, 32, 24);
        bar.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView titleBar = new TextView(this);
        titleBar.setText("QQ音乐登录");
        titleBar.setTextColor(Color.WHITE);
        titleBar.setTextSize(16);
        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.0f);
        titleBar.setLayoutParams(titleParams);

        TextView closeBtn = new TextView(this);
        closeBtn.setText("✕ 关闭");
        closeBtn.setTextColor(Color.parseColor("#aaaaaa"));
        closeBtn.setTextSize(14);
        closeBtn.setPadding(24, 8, 8, 8);
        closeBtn.setOnClickListener(v -> cancelLogin());

        bar.addView(titleBar);
        bar.addView(closeBtn);
        root.addView(bar);

        webView = new WebView(this);
        LinearLayout.LayoutParams webParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT);
        webParams.weight = 1.0f;
        webView.setLayoutParams(webParams);
        root.addView(webView);

        setContentView(root);

        setupWebView();

        startTime = System.currentTimeMillis();
        webView.loadUrl(LOGIN_URL);
        Log.i(T, "QQ Login WebView started, loading " + LOGIN_URL);
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void setupWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setUserAgentString(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
                "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        );

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(webView, true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                Log.i(T, "Page loaded: " + url);
                injectAutoClickScript();
                startCookiePolling();
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return false;
            }

            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                Log.w(T, "SSL error: " + error.toString());
                handler.proceed();
            }
        });

        webView.setWebChromeClient(new WebChromeClient());
    }

    private void injectAutoClickScript() {
        String js = "setTimeout(function(){" +
            "var docs=[document];" +
            "document.querySelectorAll('iframe').forEach(function(f){" +
                "try{if(f.contentDocument)docs.push(f.contentDocument);}catch(_){}" +
            "});" +
            "for(var d=0;d<docs.length;d++){" +
                "var nodes=docs[d].querySelectorAll('a,button,span,div');" +
                "for(var i=0;i<nodes.length;i++){" +
                    "var n=nodes[i];" +
                    "var t=(n.textContent||'').trim();" +
                    "if(!/登录|立即登录|QQ登录|微信登录/.test(t))continue;" +
                    "var r=n.getBoundingClientRect();" +
                    "if(r.width>0&&r.height>0){n.click();return;}" +
                "}" +
            "}" +
        "},1500);";
        webView.evaluateJavascript(js, null);
    }

    private void startCookiePolling() {
        if (loginDetected) return;
        pollRunnable = new Runnable() {
            @Override
            public void run() {
                if (loginDetected) return;

                if (System.currentTimeMillis() - startTime > TIMEOUT_MS) {
                    Log.w(T, "Login timed out");
                    try {
                        Map<String, String> cookies = collectAllCookies();
                        if (hasUin(cookies) && hasMusicKey(cookies)) {
                            Log.i(T, "Timeout but web login found, returning partial");
                            returnCookie(cookies, true);
                            return;
                        }
                    } catch (Exception ignored) {}
                    Toast.makeText(QQLoginWebViewActivity.this,
                            "登录超时，请重试", Toast.LENGTH_SHORT).show();
                    cancelLogin();
                    return;
                }

                checkCookies();
                handler.postDelayed(this, POLL_INTERVAL_MS);
            }
        };
        handler.postDelayed(pollRunnable, POLL_INTERVAL_MS);
    }

    private boolean hasUin(Map<String, String> map) {
        for (String key : UIN_KEYS) {
            String val = map.get(key);
            if (val != null && val.replaceAll("\\D", "").length() > 0) return true;
        }
        return false;
    }

    private boolean hasMusicKey(Map<String, String> map) {
        for (String key : MUSIC_KEYS) {
            if (map.containsKey(key) && map.get(key).length() > 0) return true;
        }
        return false;
    }

    private boolean hasPlaybackKey(Map<String, String> map) {
        for (String key : PLAYBACK_KEYS) {
            if (map.containsKey(key) && map.get(key).length() > 0) return true;
        }
        return false;
    }

    private void checkCookies() {
        if (loginDetected) return;

        try {
            Map<String, String> allCookies = collectAllCookies();
            long now = System.currentTimeMillis();

            boolean hasUin = hasUin(allCookies);
            boolean hasPKey = hasPlaybackKey(allCookies);

            if (hasUin && hasPKey) {
                loginDetected = true;
                returnCookie(allCookies, false);
                return;
            }

            if (hasUin && hasMusicKey(allCookies) && !hasPKey) {
                if (!warmupStarted || (now - lastWarmupTime > WARMUP_RETRY_MS)) {
                    warmupRetryCount++;
                    if (!warmupStarted) {
                        warmupStarted = true;
                        Log.i(T, "Login detected, navigating to player page for qm_keyst...");
                    } else {
                        Log.i(T, "Retrying player page (attempt " + warmupRetryCount + ")");
                    }
                    lastWarmupTime = now;
                    handler.post(() -> {
                        if (webView != null && !loginDetected) {
                            webView.loadUrl(WARMUP_URL);
                            if (warmupRetryCount <= 1) {
                                Toast.makeText(QQLoginWebViewActivity.this,
                                        "正在获取播放授权…", Toast.LENGTH_SHORT).show();
                            }
                        }
                    });
                }
            }
        } catch (Exception e) {
            Log.w(T, "Cookie check failed: " + e.getMessage());
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  Cookie collection — reads WebView's SQLite cookie DB directly
    //  (equivalent to PC Electron's session.cookies.get({}))
    // ═══════════════════════════════════════════════════════════════

    // PC Electron filters by: *.y.qq.com, *.qqmusic.qq.com, *.qq.com
    private boolean isQQDomain(String hostKey) {
        if (hostKey == null) return false;
        String h = hostKey.toLowerCase().trim();
        if (h.isEmpty()) return false;
        if (h.equals("y.qq.com") || h.endsWith(".y.qq.com")) return true;
        if (h.equals("qqmusic.qq.com") || h.endsWith(".qqmusic.qq.com")) return true;
        if (h.equals("qq.com") || h.endsWith(".qq.com")) return true;
        return false;
    }

    // Domain score matching PC Electron qqLoginCookieCandidateScore
    private int domainScoreFromHost(String hostKey) {
        if (hostKey == null) return 80;
        String h = hostKey.toLowerCase().trim();
        if (h.equals("y.qq.com") || h.endsWith(".y.qq.com")) return 400;
        if (h.equals("qqmusic.qq.com") || h.endsWith(".qqmusic.qq.com")) return 360;
        if (h.equals("qq.com")) return 240;
        if (h.endsWith(".qq.com")) return 160;
        return 80;
    }

    /**
     * Collect ALL cookies from the WebView cookie database, filtered to QQ domains.
     * This is the Android equivalent of Electron's session.cookies.get({}) +
     * buildCookieHeaderFor(cookies, isQQCookieDomain, priority).
     */
    private Map<String, String> collectAllCookies() {
        // First, read directly from the cookie DB (most comprehensive, like PC Electron)
        Map<String, String> dbCookies = readCookiesFromDatabase();

        // Merge with CookieManager results (catches cookies not yet written to DB)
        Map<String, String> cmCookies = readCookiesFromCookieManager();

        // Cookie DB values take precedence (they're the persisted, complete values)
        Map<String, String> merged = new LinkedHashMap<>(cmCookies);
        merged.putAll(dbCookies);

        Log.i(T, "Cookie collection: db=" + dbCookies.size() + " cm=" + cmCookies.size() + " merged=" + merged.size());
        return merged;
    }

    /**
     * Read the WebView's SQLite cookie database — equivalent to Electron's
     * session.cookies.get({}) which returns ALL cookies in the session store.
     * We filter to QQ-related domains just like PC's isQQCookieDomain.
     */
    private Map<String, String> readCookiesFromDatabase() {
        Map<String, CookieEntry> scored = new LinkedHashMap<>();

        for (File dbFile : getCookieDbPaths()) {
            if (!dbFile.exists() || !dbFile.canRead()) {
                Log.d(T, "Cookie DB not found: " + dbFile.getAbsolutePath());
                continue;
            }
            Log.i(T, "Found cookie DB: " + dbFile.getAbsolutePath() + " (" + dbFile.length() + " bytes)");

            File tmpFile = null;
            SQLiteDatabase db = null;
            Cursor cursor = null;
            try {
                // Copy to temp to avoid locking issues with live WebView DB
                tmpFile = new File(getCacheDir(), "cookietmp_" + System.currentTimeMillis() + ".db");
                copyFile(dbFile, tmpFile);

                db = SQLiteDatabase.openDatabase(tmpFile.getAbsolutePath(),
                        null, SQLiteDatabase.OPEN_READONLY);

                cursor = db.rawQuery(
                        "SELECT host_key, name, value, expires_utc, is_secure, is_httponly " +
                        "FROM cookies ORDER BY creation_utc DESC",
                        null);

                int hostCol = cursor.getColumnIndex("host_key");
                int nameCol = cursor.getColumnIndex("name");
                int valueCol = cursor.getColumnIndex("value");
                int expiresCol = cursor.getColumnIndex("expires_utc");
                int scoreCount = 0;

                while (cursor.moveToNext()) {
                    String hostKey = cursor.getString(hostCol);
                    if (!isQQDomain(hostKey)) continue;

                    String name = cursor.getString(nameCol);
                    String value = cursor.getString(valueCol);
                    if (name == null || name.isEmpty()) continue;
                    if (value == null) value = "";

                    // Check expiry (like PC's cookieIsExpired)
                    long expiresUtc = cursor.getLong(expiresCol);
                    if (expiresUtc > 0 && expiresUtc < System.currentTimeMillis() / 1000) {
                        continue; // expired
                    }

                    int score = domainScoreFromHost(hostKey);
                    CookieEntry existing = scored.get(name);
                    if (existing == null || score > existing.score ||
                            (score == existing.score && value.length() > existing.value.length())) {
                        scored.put(name, new CookieEntry(hostKey, value, score));
                        scoreCount++;
                    }
                }
                Log.i(T, "Read " + scoreCount + " QQ cookies from database");

            } catch (Exception e) {
                Log.w(T, "Cookie DB read failed (" + dbFile.getName() + "): " + e.getMessage());
            } finally {
                if (cursor != null) { try { cursor.close(); } catch (Exception ignored) {} }
                if (db != null) { try { db.close(); } catch (Exception ignored) {} }
                if (tmpFile != null) { tmpFile.delete(); }
            }
        }

        // Convert scored map to simple name→value map
        Map<String, String> result = new LinkedHashMap<>();
        for (Map.Entry<String, CookieEntry> e : scored.entrySet()) {
            result.put(e.getKey(), e.getValue().value);
        }
        return result;
    }

    /**
     * Fallback: collect cookies via CookieManager per-domain queries.
     * Less comprehensive than DB read (only returns cookies visible to
     * specific URLs), but catches any cookies not yet persisted to DB.
     */
    private Map<String, String> readCookiesFromCookieManager() {
        CookieManager cm = CookieManager.getInstance();
        Map<String, String> map = new LinkedHashMap<>();
        // Query a broad set — .qq.com cookies are returned by any *.qq.com URL
        String[] urls = {
            webView != null && webView.getUrl() != null ? webView.getUrl() : null,
            "https://y.qq.com",
            "https://qq.com",
            "https://ptlogin2.qq.com",
            "https://graph.qq.com",
        };
        for (String url : urls) {
            if (url == null) continue;
            String cookies = cm.getCookie(url);
            if (cookies == null || cookies.isEmpty()) continue;
            for (String part : cookies.split(";")) {
                String trimmed = part.trim();
                if (trimmed.isEmpty()) continue;
                int eq = trimmed.indexOf('=');
                if (eq <= 0) continue;
                String key = trimmed.substring(0, eq).trim();
                String value = trimmed.substring(eq + 1).trim();
                if (!map.containsKey(key) || (value.length() > map.get(key).length())) {
                    map.put(key, value);
                }
            }
        }
        return map;
    }

    private void copyFile(File src, File dst) throws Exception {
        try (InputStream in = new FileInputStream(src);
             OutputStream out = new FileOutputStream(dst)) {
            byte[] buf = new byte[8192];
            int len;
            while ((len = in.read(buf)) > 0) {
                out.write(buf, 0, len);
            }
        }
    }

    // Cookie entry with domain + score (PC Electron style)
    private static class CookieEntry {
        String domain;
        String value;
        int score;
        CookieEntry(String domain, String value, int score) {
            this.domain = domain; this.value = value; this.score = score;
        }
    }

    private String buildOrderedCookie(Map<String, String> map) {
        List<String> ordered = new ArrayList<>();
        Set<String> used = new HashSet<>();
        for (String priorityKey : COOKIE_PRIORITY) {
            if (map.containsKey(priorityKey)) {
                ordered.add(priorityKey + "=" + map.get(priorityKey));
                used.add(priorityKey);
            }
        }
        List<String> remaining = new ArrayList<>(map.keySet());
        Collections.sort(remaining);
        for (String key : remaining) {
            if (!used.contains(key)) {
                ordered.add(key + "=" + map.get(key));
            }
        }
        return String.join("; ", ordered);
    }

    private void returnCookie(Map<String, String> allCookies, boolean partial) {
        if (pollRunnable != null) {
            handler.removeCallbacks(pollRunnable);
        }
        // Flush CookieManager before reading to ensure latest cookies are on disk
        CookieManager.getInstance().flush();
        Log.i(T, "CookieManager flushed, collecting final cookies... (partial=" + partial + ")");

        // Collect with staggered delays to capture async cookie writes.
        // PC Electron reads the session store synchronously, but Android's
        // CookieManager.flush() + SQLite write is async.
        handler.postDelayed(() -> {
            Map<String, String> round1 = collectAllCookies();
            // Also dump document.cookie for non-HTTPOnly cookies
            dumpJsCookies(round1);
            handler.postDelayed(() -> {
                Map<String, String> round2 = collectAllCookies();
                dumpJsCookies(round2);
                handler.postDelayed(() -> {
                    Map<String, String> round3 = collectAllCookies();
                    dumpJsCookies(round3);
                    // Merge: later rounds override for length (newer values)
                    Map<String, String> merged = new LinkedHashMap<>(round1);
                    for (Map.Entry<String, String> e : round2.entrySet()) {
                        String existing = merged.get(e.getKey());
                        if (existing == null || existing.isEmpty() ||
                                e.getValue().length() > existing.length()) {
                            merged.put(e.getKey(), e.getValue());
                        }
                    }
                    for (Map.Entry<String, String> e : round3.entrySet()) {
                        String existing = merged.get(e.getKey());
                        if (existing == null || existing.isEmpty() ||
                                e.getValue().length() >= existing.length()) {
                            merged.put(e.getKey(), e.getValue());
                        }
                    }
                    String cookie = buildOrderedCookie(merged);
                    // Log key cookie presence
                    Log.i(T, "Final: uin=" + merged.containsKey("uin") +
                            " qm_keyst=" + merged.containsKey("qm_keyst") +
                            " p_skey=" + merged.containsKey("p_skey") +
                            " skey=" + merged.containsKey("skey") +
                            " login_type=" + merged.containsKey("login_type") +
                            " pt4_token=" + merged.containsKey("pt4_token") +
                            " count=" + merged.size());
                    postCookieToServer(cookie);
                    sendResult(cookie, partial);
                }, 2500);
            }, 2000);
        }, 1000);
    }

    private void dumpJsCookies(Map<String, String> map) {
        if (webView == null) return;
        try {
            webView.evaluateJavascript("(function(){return document.cookie||'';})()", rawValue -> {
                if (rawValue == null || rawValue.isEmpty() || "null".equals(rawValue)) return;
                String jsCookie = rawValue;
                if (jsCookie.startsWith("\"") && jsCookie.endsWith("\"")) {
                    jsCookie = jsCookie.substring(1, jsCookie.length() - 1);
                }
                jsCookie = jsCookie.replace("\\\"", "\"").replace("\\\\", "\\");
                if (jsCookie.isEmpty()) return;
                for (String part : jsCookie.split(";")) {
                    String trimmed = part.trim();
                    if (trimmed.isEmpty()) continue;
                    int eq = trimmed.indexOf('=');
                    if (eq <= 0) continue;
                    String key = trimmed.substring(0, eq).trim();
                    String cookieVal = trimmed.substring(eq + 1).trim();
                    if (!map.containsKey(key) || map.get(key).isEmpty()) {
                        map.put(key, cookieVal);
                    }
                }
            });
        } catch (Exception e) {
            Log.w(T, "JS cookie dump failed: " + e.getMessage());
        }
    }

    private void sendResult(String cookie, boolean partial) {
        Intent resultIntent = new Intent();
        resultIntent.putExtra("ok", true);
        resultIntent.putExtra("cookie", cookie);
        if (partial) resultIntent.putExtra("partial", true);
        setResult(Activity.RESULT_OK, resultIntent);

        Toast.makeText(QQLoginWebViewActivity.this,
                partial ? "QQ音乐登录成功（播放授权可能不完整）" : "QQ音乐登录成功！",
                Toast.LENGTH_SHORT).show();
        Log.i(T, "QQ Login successful (partial=" + partial + ")");
        handler.postDelayed(this::finish, 800);
    }

    private void postCookieToServer(final String cookie) {
        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                java.net.URL url = new java.net.URL("http://localhost:3000/api/qq/login/cookie");
                conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setDoOutput(true);
                conn.setConnectTimeout(4000);
                conn.setReadTimeout(4000);

                JSONObject json = new JSONObject();
                json.put("cookie", cookie);
                String jsonStr = json.toString();

                java.io.OutputStream os = conn.getOutputStream();
                os.write(jsonStr.getBytes("UTF-8"));
                os.flush();
                os.close();

                int code = conn.getResponseCode();
                String responseBody = "";
                try {
                    java.io.InputStream is = conn.getInputStream();
                    responseBody = new java.util.Scanner(is, "UTF-8").useDelimiter("\\A").next();
                    is.close();
                } catch (Exception ignored) {}
                Log.i(T, "Server POST /api/qq/login/cookie → HTTP " + code);
            } catch (Exception e) {
                Log.w(T, "Failed to post QQ cookie: " + e.getClass().getSimpleName() + " " + e.getMessage());
            } finally {
                if (conn != null) conn.disconnect();
            }
        }).start();
    }

    private void cancelLogin() {
        if (loginDetected) return;
        if (pollRunnable != null) handler.removeCallbacks(pollRunnable);
        setResult(Activity.RESULT_CANCELED);
        Log.i(T, "QQ Login cancelled");
        finish();
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            cancelLogin();
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (pollRunnable != null) handler.removeCallbacks(pollRunnable);
        if (webView != null) webView.destroy();
    }
}
