package com.mineradio.app;

import android.content.Intent;
import android.util.Log;
import android.webkit.CookieManager;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NeteaseLogin")
public class NeteaseLoginPlugin extends Plugin {

    private static final String T = "NeteaseLoginPlugin";

    @PluginMethod
    public void hasPlatformLogin(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("value", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void openLogin(PluginCall call) {
        Log.i(T, "openLogin called");
        Intent intent = new Intent(getActivity(), LoginWebViewActivity.class);
        startActivityForResult(call, intent, "handleLoginResult");
    }

    @PluginMethod
    public void clearLogin(PluginCall call) {
        Log.i(T, "clearLogin called");
        try {
            CookieManager.getInstance().removeAllCookies(null);
        } catch (Exception e) {
            Log.w(T, "Cookie clear failed: " + e.getMessage());
        }
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    @ActivityCallback
    protected void handleLoginResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            Log.w(T, "handleLoginResult: call is null");
            return;
        }

        int resultCode = result.getResultCode();
        Intent data = result.getData();

        if (resultCode == android.app.Activity.RESULT_OK && data != null) {
            boolean ok = data.getBooleanExtra("ok", false);
            String cookie = data.getStringExtra("cookie");

            JSObject ret = new JSObject();
            ret.put("ok", ok);
            if (cookie != null) {
                ret.put("cookie", cookie);
            }
            call.resolve(ret);
            Log.i(T, "Login result: ok=" + ok + " cookieLen=" + (cookie != null ? cookie.length() : 0));
        } else {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("cancelled", true);
            call.resolve(ret);
            Log.i(T, "Login cancelled or failed");
        }
    }
}
