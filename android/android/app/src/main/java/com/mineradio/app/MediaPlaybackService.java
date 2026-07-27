package com.mineradio.app;

import android.app.Service;
import android.content.Intent;
import android.os.IBinder;

/**
 * Minimal media playback service to satisfy Android 14+ foregroundServiceType requirement.
 * Actual playback is handled by the WebView/Node.js server; this service exists only to
 * declare the foreground service type in the manifest.
 */
public class MediaPlaybackService extends Service {
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
