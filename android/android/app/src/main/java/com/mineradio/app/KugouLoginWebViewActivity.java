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

public class KugouLoginWebViewActivity extends AppCompatActivity {

    private static final String T = "MINERADIO-KUGOU-LOGIN";
    private static final String LOGIN_URL = "https://www.kugou.com/";
    private static final String WARMUP_URL = "https://www.kugou.com/newuc/user/uc/type=edit";
    private static final String[] COOKIE_DOMAINS = {
        "https://www.kugou.com",
        "https://kugou.com",
        "https://passport.kugou.com",
        "https://m.kugou.com",
    };
    // Same priority order as PC Electron KUGOU_LOGIN_COOKIE_PRIORITY
    private static final String[] COOKIE_PRIORITY = {
        "KuGoo", "token", "userid",
        "KugooID", "kugouID", "UserId",
        "kg_mid", "kg_dfid",
        "Kugou", "NickName",
    };
    private static final long POLL_INTERVAL_MS = 1500L;
    private static final long TIMEOUT_MS = 5 * 60 * 1000L; // 5 min

    private WebView webView;
    private TextView titleBar;
    private Handler handler = new Handler(Looper.getMainLooper());
    private Runnable pollRunnable;
    private long startTime;
    private boolean loginDetected = false;
    private boolean warmupStarted = false;
    // Login markers: userid or KuGoo/KugooID/Kugou present
    private static final String[] LOGIN_MARKERS = {"userid", "KugooID", "kugouID", "UserId", "KuGoo"};
    // Playback marker: token present
    private static final String[] PLAYBACK_MARKERS = {"token"};

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
        titleBar.setText("酷狗音乐登录");
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
        Log.i(T, "Kugou Login WebView started, loading " + LOGIN_URL);
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
                    "if(!/登录|登陆|立即登录|账号登录/.test(t))continue;" +
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
                    Toast.makeText(KugouLoginWebViewActivity.this,
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

    private boolean hasLoginMarker(Map<String, String> map) {
        for (String key : LOGIN_MARKERS) {
            if (map.containsKey(key) && map.get(key).length() > 0) return true;
        }
        return false;
    }

    private boolean hasPlaybackToken(Map<String, String> map) {
        for (String key : PLAYBACK_MARKERS) {
            if (map.containsKey(key) && map.get(key).length() > 0) return true;
        }
        return false;
    }

    private void checkCookies() {
        if (loginDetected) return;

        try {
            CookieManager cm = CookieManager.getInstance();
            Map<String, String> allCookies = collectCookiesFromAllDomains(cm);

            if (hasLoginMarker(allCookies) && hasPlaybackToken(allCookies)) {
                // Full login: userid/KuGoo + token both present
                loginDetected = true;
                returnCookie(allCookies);
            } else if (hasLoginMarker(allCookies) && !warmupStarted) {
                // Account login detected but no playback token — warmup
                warmupStarted = true;
                Log.i(T, "Login detected, navigating to warmup URL for playback token...");
                handler.post(() -> {
                    if (webView != null && !loginDetected) {
                        webView.loadUrl(WARMUP_URL);
                        Toast.makeText(KugouLoginWebViewActivity.this,
                                "正在获取播放授权…", Toast.LENGTH_SHORT).show();
                    }
                });
            }
        } catch (Exception e) {
            Log.w(T, "Cookie check failed: " + e.getMessage());
        }
    }

    private Map<String, String> collectCookiesFromAllDomains(CookieManager cm) {
        Map<String, String> map = new LinkedHashMap<>();
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
                map.put(key, value);
            }
        }
        return map;
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

    private void returnCookie(Map<String, String> allCookies) {
        if (pollRunnable != null) {
            handler.removeCallbacks(pollRunnable);
        }
        CookieManager cm = CookieManager.getInstance();
        cm.flush();
        Log.i(T, "CookieManager flushed, collecting final cookies...");
        // Two-round collection after flush for completeness
        handler.postDelayed(() -> {
            Map<String, String> round1 = collectCookiesFromAllDomains(cm);
            handler.postDelayed(() -> {
                Map<String, String> round2 = collectCookiesFromAllDomains(cm);
                Map<String, String> finalMap = new LinkedHashMap<>(round1);
                finalMap.putAll(round2);
                String cookie = buildOrderedCookie(finalMap);
                postCookieToServer(cookie);
                sendResult(cookie);
            }, 2500);
        }, 500);
    }

    private void sendResult(String cookie) {
        Intent resultIntent = new Intent();
        resultIntent.putExtra("ok", true);
        resultIntent.putExtra("cookie", cookie);
        setResult(Activity.RESULT_OK, resultIntent);

        Toast.makeText(KugouLoginWebViewActivity.this, "酷狗音乐登录成功！", Toast.LENGTH_SHORT).show();
        Log.i(T, "Kugou Login successful");

        handler.postDelayed(this::finish, 800);
    }

    private void postCookieToServer(final String cookie) {
        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                java.net.URL url = new java.net.URL("http://localhost:3000/api/kugou/login/cookie");
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
                Log.i(T, "Server POST /api/kugou/login/cookie → HTTP " + code + " body:" + responseBody.substring(0, Math.min(200, responseBody.length())));
            } catch (Exception e) {
                Log.w(T, "Failed to post Kugou cookie to server: " + e.getClass().getSimpleName() + " " + e.getMessage());
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
        Log.i(T, "Kugou Login cancelled");
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
