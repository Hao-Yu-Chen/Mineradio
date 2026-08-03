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
import java.util.TreeSet;
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

public class LoginWebViewActivity extends AppCompatActivity {

    private static final String T = "MINERADIO-LOGIN";
    private static final String LOGIN_URL = "https://music.163.com/#/login";
    private static final String COOKIE_DOMAIN = "https://music.163.com";
    // Collect cookies from multiple Netease domains — the login flow sets
    // cookies across subdomains (interface.music.163.com, api.music.163.com,
    // etc.) and CookieManager.getCookie() only returns per-domain cookies.
    private static final String[] COOKIE_DOMAINS = {
        "https://music.163.com",
        "https://interface.music.163.com",
        "https://interface3.music.163.com",
        "https://api.music.163.com",
        "https://www.163.com",
        "https://netease.com",
    };
    // Same priority order as PC Electron: important auth cookies first,
    // then tracking, then everything else appended at the end.
    private static final String[] COOKIE_PRIORITY = {
        "MUSIC_U", "__csrf", "NMTID", "MUSIC_A", "MUSIC_A_T", "MUSIC_R_T",
        "__remember_me", "_ntes_nuid", "_ntes_nnid", "WEVNSM", "WNMCID",
        "JSESSIONID-WYYY", "_gid",
    };
    private static final long POLL_INTERVAL_MS = 1500L;
    private static final long TIMEOUT_MS = 5 * 60 * 1000L; // 5 min

    private WebView webView;
    private TextView titleBar;
    private Handler handler = new Handler(Looper.getMainLooper());
    private Runnable pollRunnable;
    private long startTime;
    private boolean loginDetected = false;

    // Required cookies that indicate a successful login
    private static final String[] LOGIN_COOKIE_MARKERS = {"MUSIC_U", "MUSIC_A"};
    // MUSIC_U must be at least this long to be considered a complete login token.
    // Incomplete/short MUSIC_U values are temporary and will be replaced.
    private static final int MIN_MUSIC_U_LENGTH = 200;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Build UI programmatically: title bar + WebView
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
        titleBar.setText("网易云音乐登录");
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

        // Setup WebView
        setupWebView();

        startTime = System.currentTimeMillis();
        webView.loadUrl(LOGIN_URL);
        Log.i(T, "Login WebView started, loading " + LOGIN_URL);
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

        // Enable cookies
        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(webView, true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                Log.i(T, "Page loaded: " + url);
                titleBar.setText(url.contains("login") ? "网易云音乐登录" : "网易云音乐");

                // Auto-click login buttons (same approach as PC)
                injectAutoClickScript();

                // Start polling cookies
                startCookiePolling();
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // Keep all navigation inside the WebView
                return false;
            }

            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                // Accept SSL errors on some devices
                Log.w(T, "SSL error: " + error.toString());
                handler.proceed();
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                if (newProgress > 50 && !loginDetected) {
                    // Title reflects loading state
                }
            }
        });
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
                    "if(!/登录|立即登录/.test(t))continue;" +
                    "var r=n.getBoundingClientRect();" +
                    "if(r.width>0&&r.height>0){n.click();return;}" +
                "}" +
            "}" +
        "},1200);";
        webView.evaluateJavascript(js, null);
    }

    private void startCookiePolling() {
        if (loginDetected) return;

        pollRunnable = new Runnable() {
            @Override
            public void run() {
                if (loginDetected) return;

                // Check timeout
                if (System.currentTimeMillis() - startTime > TIMEOUT_MS) {
                    Log.w(T, "Login timed out");
                    Toast.makeText(LoginWebViewActivity.this,
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

    private void checkCookies() {
        if (loginDetected) return;

        try {
            CookieManager cm = CookieManager.getInstance();

            // Check ALL Netease domains: must have MUSIC_U of sufficient length.
            // Short MUSIC_U values are temporary/intermediate tokens set during
            // the login redirect flow; the real token arrives later.
            String bestMusicU = "";
            boolean hasMarker = false;
            for (String domain : COOKIE_DOMAINS) {
                String cookies = cm.getCookie(domain);
                if (cookies == null || cookies.isEmpty()) continue;
                for (String marker : LOGIN_COOKIE_MARKERS) {
                    if (cookies.contains(marker + "=")) {
                        hasMarker = true;
                        // Extract the value to check its length
                        String extracted = extractCookieValue(cookies, marker);
                        if (extracted.length() > bestMusicU.length()) {
                            bestMusicU = extracted;
                        }
                    }
                }
            }

            if (hasMarker && bestMusicU.length() >= MIN_MUSIC_U_LENGTH) {
                        loginDetected = true;
                returnCookie();
            } else if (hasMarker) {
                    }
        } catch (Exception e) {
            Log.w(T, "Cookie check failed: " + e.getMessage());
        }
    }

    private String extractCookieValue(String cookies, String key) {
        String prefix = key + "=";
        int start = cookies.indexOf(prefix);
        if (start < 0) return "";
        start += prefix.length();
        int end = cookies.indexOf(";", start);
        if (end < 0) end = cookies.length();
        return cookies.substring(start, end).trim();
    }

    private void returnCookie() {
        if (pollRunnable != null) {
            handler.removeCallbacks(pollRunnable);
        }
        CookieManager cm = CookieManager.getInstance();
        cm.flush();
        Log.i(T, "CookieManager flushed, collecting cookies...");
        handler.postDelayed(() -> {
            java.util.Map<String, String> round1 = collectCookiesFromAllDomains(cm);
                handler.postDelayed(() -> {
                java.util.Map<String, String> round2 = collectCookiesFromAllDomains(cm);
                java.util.Map<String, String> finalMap = new java.util.LinkedHashMap<>(round1);
                finalMap.putAll(round2);
                buildAndSendCookie(finalMap);
            }, 2500);
        }, 500);
    }

    private java.util.Map<String, String> collectCookiesFromAllDomains(CookieManager cm) {
        java.util.Map<String, String> map = new java.util.LinkedHashMap<>();
        for (String domain : COOKIE_DOMAINS) {
            String cookies = cm.getCookie(domain);
            if (cookies == null || cookies.isEmpty()) continue;
            for (String part : cookies.split(";")) {
                String trimmed = part.trim();
                if (trimmed.isEmpty()) continue;
                int eq = trimmed.indexOf('=');
                if (eq <= 0) continue;
                String key = trimmed.substring(0, eq).trim();
                String value = trimmed.substring(eq + 1).trim();
                // Keep first occurrence per domain scan, but allow overwrite
                // by later domains (round2 values win over round1)
                map.put(key, value);
            }
        }
        return map;
    }

    private void buildAndSendCookie(java.util.Map<String, String> map) {
        // Reorder: PC-priority keys first, then remaining sorted alphabetically
        java.util.List<String> ordered = new java.util.ArrayList<>();
        java.util.Set<String> used = new java.util.HashSet<>();
        for (String priorityKey : COOKIE_PRIORITY) {
            if (map.containsKey(priorityKey)) {
                ordered.add(priorityKey + "=" + map.get(priorityKey));
                used.add(priorityKey);
            }
        }
        // Append remaining keys sorted for consistency
        java.util.List<String> remaining = new java.util.ArrayList<>(map.keySet());
        java.util.Collections.sort(remaining);
        for (String key : remaining) {
            if (!used.contains(key)) {
                ordered.add(key + "=" + map.get(key));
            }
        }
        String finalCookie = String.join("; ", ordered);


        postCookieToServer(finalCookie);

        Intent resultIntent = new Intent();
        resultIntent.putExtra("ok", true);
        resultIntent.putExtra("cookie", finalCookie);
        setResult(Activity.RESULT_OK, resultIntent);

        Toast.makeText(LoginWebViewActivity.this, "登录成功！", Toast.LENGTH_SHORT).show();
        Log.i(T, "Login successful");

        handler.postDelayed(this::finish, 800);
    }

    private void postCookieToServer(final String cookie) {
        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                java.net.URL url = new java.net.URL("http://localhost:3000/api/login/cookie");
                conn = (java.net.HttpURLConnection) url.openConnection();
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
                Log.i(T, "Server POST /api/login/cookie → HTTP " + code + " body:" + responseBody.substring(0, Math.min(200, responseBody.length())));
            } catch (Exception e) {
                Log.w(T, "Failed to post cookie to server: " + e.getClass().getSimpleName() + " " + e.getMessage());
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
        Log.i(T, "Login cancelled");
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
