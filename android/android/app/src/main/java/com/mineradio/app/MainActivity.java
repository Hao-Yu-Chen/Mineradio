package com.mineradio.app;

import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.widget.Toast;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static final String T = "MINERADIO";

    private void enableFullScreen() {
        // Edge-to-edge: draw behind system bars
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(false);
            WindowInsetsController ctrl = getWindow().getInsetsController();
            if (ctrl != null) {
                ctrl.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                ctrl.setSystemBarsBehavior(
                    WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            );
        }

        // Fill under-display camera cutout area
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }

        // Transparent system bars
        getWindow().setStatusBarColor(android.graphics.Color.TRANSPARENT);
        getWindow().setNavigationBarColor(android.graphics.Color.TRANSPARENT);
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Must add custom plugins BEFORE super.onCreate() because
        // BridgeActivity creates the bridge inside its onCreate(),
        // which scans initialPlugins to register all plugins.
        initialPlugins.add(NeteaseLoginPlugin.class);
        initialPlugins.add(QQLoginPlugin.class);
        initialPlugins.add(KugouLoginPlugin.class);

        // Global crash catcher
        final Thread.UncaughtExceptionHandler oldHandler = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((t, e) -> {
            final String msg = "CRASH: " + e.getClass().getSimpleName() + "\n" +
                (e.getMessage() != null ? e.getMessage() : "(no message)");
            Log.e(T, msg, e);
            try {
                runOnUiThread(() -> Toast.makeText(getApplicationContext(), msg, Toast.LENGTH_LONG).show());
                Thread.sleep(3000);
            } catch (InterruptedException ignored3) {}
            if (oldHandler != null) oldHandler.uncaughtException(t, e);
        });

        super.onCreate(savedInstanceState);
        Log.i(T, "App started");

        enableFullScreen();

        new Thread(() -> {
            try {
                step("Loading native libs...");
                try { System.loadLibrary("nodejs-mobile-cordova-native-lib"); step("bridge OK"); }
                catch (Throwable t) { step("FAIL bridge: "+t); return; }
                try { System.loadLibrary("node"); step("node OK"); }
                catch (Throwable t) { step("FAIL node: "+t); return; }

                step("Init NodeJS...");
                new com.janeasystems.cdvnodejsmobile.NodeJS();
                com.janeasystems.cdvnodejsmobile.NodeJS.setListener(new com.janeasystems.cdvnodejsmobile.NodeJS.NodeJSListener() {
                    public void onNodeReady() { step("NodeJS READY"); }
                    public void onNodeError(String e) { step("Node err: " + e); }
                    public void onNodeMessage(String ch, String m) { step("Node msg: " + ch + " " + m); }
                });
                com.janeasystems.cdvnodejsmobile.NodeJS.init(getApplicationContext());
                step("init done");

                step("Starting server...");
                com.janeasystems.cdvnodejsmobile.NodeJS.startEngine("nodejs-project/server.js");
                step("startEngine done");

            } catch (Throwable t) {
                step("FATAL: " + t.getClass().getSimpleName() + " " + t.getMessage());
                Log.e(T, "FATAL", t);
            }
        }, "NodeJS").start();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) enableFullScreen();
    }

    private void step(final String msg) {
        Log.i(T, msg);
        if (msg.contains("FAIL") || msg.contains("err") || msg.contains("FATAL")) {
            try {
                runOnUiThread(() -> Toast.makeText(getApplicationContext(), msg, Toast.LENGTH_LONG).show());
            } catch (Exception ignored) {}
        }
    }

    @Override public void onPause() { super.onPause(); }
    @Override public void onResume() { super.onResume(); }
}
