package com.mineradio.app;

import android.os.Bundle;
import android.util.Log;
import android.widget.Toast;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static final String T = "MINERADIO";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Log.i(T, "App started");

        new Thread(() -> {
            // Step 1: Load native libs
            try {
                step("Loading native libs...");
                try { System.loadLibrary("nodejs-mobile-cordova-native-lib"); step("bridge OK"); }
                catch (Throwable t) { step("FAIL bridge: "+t); return; }
                try { System.loadLibrary("node"); step("node OK"); }
                catch (Throwable t) { step("FAIL node: "+t); return; }

                // Step 2: Create instance and init
                step("Init NodeJS...");
                new com.janeasystems.cdvnodejsmobile.NodeJS();
                com.janeasystems.cdvnodejsmobile.NodeJS.setListener(new com.janeasystems.cdvnodejsmobile.NodeJS.NodeJSListener() {
                    public void onNodeReady() { step("NodeJS READY"); }
                    public void onNodeError(String e) { step("Node err: " + e); }
                    public void onNodeMessage(String ch, String m) { step("Node msg: " + ch + " " + m); }
                });
                com.janeasystems.cdvnodejsmobile.NodeJS.init(getApplicationContext());
                step("init done");

                // Step 3: Start engine
                step("Starting server...");
                com.janeasystems.cdvnodejsmobile.NodeJS.startEngine("nodejs-project/server.js");
                step("startEngine done — loading.html polls for readiness");

            } catch (Throwable t) {
                step("FATAL: " + t.getClass().getSimpleName() + " " + t.getMessage());
                Log.e(T, "FATAL", t);
            }
        }, "NodeJS").start();
    }

    private void step(final String msg) {
        Log.i(T, msg);
        // Only show Toast for errors — success messages are logged but not displayed
        if (msg.contains("FAIL") || msg.contains("err") || msg.contains("FATAL")) {
            try {
                runOnUiThread(() -> Toast.makeText(getApplicationContext(), msg, Toast.LENGTH_LONG).show());
            } catch (Exception ignored) {}
        }
    }

    @Override public void onPause() { super.onPause(); }
    @Override public void onResume() { super.onResume(); }
}
