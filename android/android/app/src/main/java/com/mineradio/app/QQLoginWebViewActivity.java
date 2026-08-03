package com.mineradio.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.http.SslError;
import android.os.Bundle;
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
    // Collect cookies from all QQ Music related domains (matching PC isQQCookieDomain)
    private static final String[] COOKIE_DOMAINS = {
        "https://y.qq.com",
        "https://c.y.qq.com",
        "https://u.y.qq.com",
        "https://i.y.qq.com",
        "https://qqmusic.qq.com",
        "https://music.qq.com",
        "https://qq.com",
        "https://graph.qq.com",
        "https://ptlogin2.qq.com",
        "https://ssl.ptlogin2.qq.com",
        "https://open.qq.com",
    };
    // Domain score matching PC Electron qqLoginCookieCandidateScore:
    // y.qq.com = 400, qqmusic.qq.com = 360, qq.com = 240, *.qq.com = 160
    private static int domainScore(String domain) {
        String d = domain.replaceFirst("^https?://", "").toLowerCase();
        if (d.equals("y.qq.com") || d.endsWith(".y.qq.com")) return 400;
        if (d.equals("qqmusic.qq.com") || d.endsWith(".qqmusic.qq.com")) return 360;
        if (d.equals("qq.com")) return 240;
        if (d.endsWith(".qq.com")) return 160;
        return 80;
    }
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
    private static final long WARMUP_RETRY_MS = 8000L; // retry warmup every 8s if playback key missing
    // Required markers for login: uin + music key
    private static final String[] UIN_KEYS = {"uin", "qqmusic_uin", "wxuin", "p_uin"};
    private static final String[] MUSIC_KEYS = {"qqmusic_key", "qm_keyst", "music_key", "p_skey", "skey",
        "psrf_qqaccess_token", "psrf_qqrefresh_token", "wxrefresh_token", "wxskey"};
    private static final String[] PLAYBACK_KEYS = {"qm_keyst", "qqmusic_key", "music_key", "wxskey"};

    private WebView webView;
    private TextView titleBar;
    private Handler handler = new Handler(Looper.getMainLooper());
    private Runnable pollRunnable;
    private long startTime;
    private long lastWarmupTime = 0;
    private boolean loginDetected = false;
    private boolean warmupStarted = false;

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

        // ── Title bar ──
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setBackgroundColor(Color.parseColor("#1a1a1a"));
        bar.setPadding(32, 40, 32, 24);
        bar.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        titleBar = new TextView(this);
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

        // ── WebView ──
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

                // Auto-click login buttons
                injectAutoClickScript();

                // Start polling cookies
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
                    // If we have at least a web login, return it as partial
                    try {
                        CookieManager cm = CookieManager.getInstance();
                        Map<String, String> cookies = collectCookiesFromAllDomains(cm);
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
            CookieManager cm = CookieManager.getInstance();
            Map<String, String> allCookies = collectCookiesFromAllDomains(cm);

            if (hasUin(allCookies) && hasPlaybackKey(allCookies)) {
                // Full login: uin + playback key both present
                loginDetected = true;
                returnCookie(allCookies, false);
                return;
            }

            if (hasUin(allCookies) && hasMusicKey(allCookies)) {
                long now = System.currentTimeMillis();
                // Start warmup on first detection, and retry every WARMUP_RETRY_MS
                // until playback key appears (PC Electron polls continuously after warmup)
                if (!warmupStarted || (now - lastWarmupTime > WARMUP_RETRY_MS)) {
                    if (!warmupStarted) {
                        warmupStarted = true;
                        Log.i(T, "Login detected, navigating to warmup URL for playback key...");
                    } else {
                        Log.i(T, "Playback key still missing, retrying warmup navigation...");
                    }
                    lastWarmupTime = now;
                    final boolean isRetry = warmupStarted; // already true on first call via !warmupStarted above
                    handler.post(() -> {
                        if (webView != null && !loginDetected) {
                            webView.loadUrl(WARMUP_URL);
                            if (!isRetry) {
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

    // Cookie entry with domain score for selection (like PC Electron scoring)
    private static class CookieEntry {
        String domain;
        String value;
        int score;
        CookieEntry(String domain, String value, int score) {
            this.domain = domain;
            this.value = value;
            this.score = score;
        }
    }

    private Map<String, String> collectCookiesFromAllDomains(CookieManager cm) {
        // Collect with per-key scoring: prefer y.qq.com over qq.com (match PC Electron)
        Map<String, CookieEntry> scored = new LinkedHashMap<>();
        for (String domain : COOKIE_DOMAINS) {
            String cookies = cm.getCookie(domain);
            if (cookies == null || cookies.isEmpty()) continue;
            int score = domainScore(domain);
            for (String part : cookies.split(";")) {
                String trimmed = part.trim();
                if (trimmed.isEmpty()) continue;
                int eq = trimmed.indexOf('=');
                if (eq <= 0) continue;
                String key = trimmed.substring(0, eq).trim();
                String value = trimmed.substring(eq + 1).trim();
                CookieEntry existing = scored.get(key);
                if (existing == null || score > existing.score) {
                    // Higher domain score wins (y.qq.com > qq.com)
                    scored.put(key, new CookieEntry(domain, value, score));
                } else if (score == existing.score) {
                    // Same score: longer value typically means newer/more complete cookie
                    if (value.length() > existing.value.length()) {
                        scored.put(key, new CookieEntry(domain, value, score));
                    }
                }
            }
        }
        // Convert to simple map
        Map<String, String> result = new LinkedHashMap<>();
        for (Map.Entry<String, CookieEntry> e : scored.entrySet()) {
            result.put(e.getKey(), e.getValue().value);
        }
        return result;
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
        CookieManager cm = CookieManager.getInstance();
        cm.flush();
        Log.i(T, "CookieManager flushed, collecting final cookies... (partial=" + partial + ")");
        // Three-round collection with longer intervals to capture late JS-set cookies
        // (PC Electron reads the cookie store synchronously, but Android CookieManager
        // needs flush + delay for async cookie writes to land)
        handler.postDelayed(() -> {
            Map<String, String> round1 = collectCookiesFromAllDomains(cm);
            handler.postDelayed(() -> {
                Map<String, String> round2 = collectCookiesFromAllDomains(cm);
                handler.postDelayed(() -> {
                    Map<String, String> round3 = collectCookiesFromAllDomains(cm);
                    // Merge: later rounds override (latest value wins within same score tier)
                    Map<String, String> finalMap = new LinkedHashMap<>(round1);
                    finalMap.putAll(round2);
                    finalMap.putAll(round3);
                    // Re-score and re-collect to ensure domain preference
                    // (round3 from qq.com shouldn't clobber round1 from y.qq.com)
                    Map<String, String> merged = mergeWithDomainPreference(round1, round2, round3);
                    String cookie = buildOrderedCookie(merged);
                    postCookieToServer(cookie);
                    sendResult(cookie, partial);
                }, 2000);
            }, 2000);
        }, 800);
    }

    // Merge three rounds preferring values from higher-score domains
    private Map<String, String> mergeWithDomainPreference(
            Map<String, String> r1, Map<String, String> r2, Map<String, String> r3) {
        // Re-collect across all three rounds with scoring
        Map<String, CookieEntry> scored = new LinkedHashMap<>();
        Map<String, String>[] rounds = new Map[]{r1, r2, r3};
        // Hardcoded domain scores for common patterns in cookie values
        // We don't know which domain each value came from in isolation,
        // so we use the rounds as proxy: earlier rounds (r1) are from
        // first flash, later rounds (r3) are most recent.
        // Strategy: take the first non-empty value per key, but allow
        // r3 to win if the value is substantially different (new key issued)
        Map<String, String> result = new LinkedHashMap<>(r1);
        for (Map.Entry<String, String> e : r2.entrySet()) {
            String existing = result.get(e.getKey());
            if (existing == null || existing.isEmpty() ||
                    (e.getValue() != null && e.getValue().length() > existing.length())) {
                result.put(e.getKey(), e.getValue());
            }
        }
        for (Map.Entry<String, String> e : r3.entrySet()) {
            String existing = result.get(e.getKey());
            if (existing == null || existing.isEmpty() ||
                    (e.getValue() != null && e.getValue().length() >= existing.length())) {
                result.put(e.getKey(), e.getValue());
            }
        }
        return result;
    }

    private void sendResult(String cookie, boolean partial) {
        Intent resultIntent = new Intent();
        resultIntent.putExtra("ok", true);
        resultIntent.putExtra("cookie", cookie);
        if (partial) {
            resultIntent.putExtra("partial", true);
        }
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
                Log.i(T, "Server POST /api/qq/login/cookie → HTTP " + code + " body:" + responseBody.substring(0, Math.min(200, responseBody.length())));
            } catch (Exception e) {
                Log.w(T, "Failed to post QQ cookie to server: " + e.getClass().getSimpleName() + " " + e.getMessage());
            } finally {
                if (conn != null) conn.disconnect();
            }
        }).start();
    }

    private void cancelLogin() {
        if (loginDetected) return;

        if (pollRunnable != null) {
            handler.removeCallbacks(pollRunnable);
        }

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
        if (pollRunnable != null) {
            handler.removeCallbacks(pollRunnable);
        }
        if (webView != null) {
            webView.destroy();
        }
    }
}
