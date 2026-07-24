package com.janeasystems.cdvnodejsmobile;

import android.util.Log;
import android.content.Context;
import android.content.res.AssetManager;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.SharedPreferences;
import android.system.Os;
import android.system.ErrnoException;

import java.io.*;
import java.util.ArrayList;
import java.util.concurrent.Semaphore;

public class NodeJS {

    private static final String LOGTAG = "NODEJS-MOBILE";
    private static final String SYSTEM_CHANNEL = "_SYSTEM_";
    private static final String PROJECT_ROOT = "public";
    private static final String BUILTIN_ASSETS = "nodejs-mobile-cordova-assets";
    private static final String BUILTIN_MODULES = "nodejs-mobile-cordova-assets/builtin_modules";
    private static final String TRASH_DIR = "nodejs-project-trash";
    private static final String BUILTIN_NATIVE_ASSETS_PREFIX = "nodejs-native-assets-";
    private static final String SHARED_PREFS = "NODEJS_MOBILE_PREFS";
    private static final String LAST_UPDATED_TIME = "NODEJS_MOBILE_APK_LastUpdateTime";

    private static Context context = null;
    private static AssetManager assetManager = null;
    private static String filesDir;
    private static String nodeAppRootAbsolutePath = "";
    private static String nodePath = "";
    private static String trashDir = "";
    private static String nativeAssetsPath = "";

    private static Semaphore initSemaphore = new Semaphore(1);
    private static boolean initCompleted = false;
    private static IOException initError = null;

    private static long lastUpdateTime = 1;
    private static long previousLastUpdateTime = 0;

    private static boolean engineAlreadyStarted = false;
    private static boolean nodeIsReadyForAppEvents = false;

    private static NodeJSListener listener = null;
    private static NodeJS instance = null;
    private static boolean nativeLibsLoaded = false;
    private static String loadError = null;

    static {
        try {
            // Load C++ runtime first, then native bridge, then Node.js
            try { System.loadLibrary("c++_shared"); } catch (UnsatisfiedLinkError ignored) {}
            System.loadLibrary("nodejs-mobile-cordova-native-lib");
            System.loadLibrary("node");
            nativeLibsLoaded = true;
            Log.i(LOGTAG, "Native libraries loaded successfully");
        } catch (UnsatisfiedLinkError e) {
            loadError = e.getMessage();
            Log.e(LOGTAG, "Failed to load native libraries: " + loadError);
        } catch (Throwable t) {
            loadError = t.getClass().getName() + ": " + t.getMessage();
            Log.e(LOGTAG, "Native library loading crashed: " + loadError);
        }
    }

    public NodeJS() {
        instance = this;
    }

    public static boolean isNativeLibsLoaded() { return nativeLibsLoaded; }
    public static String getLoadError() { return loadError; }

    private Integer safeStartNode(String[] args, String np, boolean redirect) {
        if (!nativeLibsLoaded) {
            Log.e(LOGTAG, "Cannot start Node: native libs not loaded");
            if (listener != null) listener.onNodeError("Native libs not loaded: " + (loadError != null ? loadError : "unknown"));
            return -1;
        }
        return startNodeWithArguments(args, np, redirect);
    }
    private void safeSendToNode(String ch, String msg) {
        if (!nativeLibsLoaded) return;
        try { sendMessageToNodeChannel(ch, msg); } catch (Throwable ignored) {}
    }
    private void safeRegisterDataDir(String dir) {
        if (!nativeLibsLoaded) return;
        try { registerNodeDataDirPath(dir); } catch (Throwable ignored) {}
    }
    private String safeGetAbi() {
        if (!nativeLibsLoaded) return "unknown";
        try { return getCurrentABIName(); } catch (Throwable t) { return "unknown"; }
    }

    public native Integer startNodeWithArguments(String[] arguments, String nodePath, boolean redirectOutputToLogcat);
    public native void sendMessageToNodeChannel(String channelName, String msg);
    public native void registerNodeDataDirPath(String dataDir);
    public native String getCurrentABIName();

    // Callback interface for notifying when node is ready
    public interface NodeJSListener {
        void onNodeReady();
        void onNodeError(String error);
        void onNodeMessage(String channel, String msg);
    }

    public static void setListener(NodeJSListener l) {
        listener = l;
    }

    // Called from JNI (native-lib.cpp)
    public static void sendMessageToApplication(String channelName, String msg) {
        if (SYSTEM_CHANNEL.equals(channelName)) {
            if ("ready-for-app-events".equals(msg)) {
                nodeIsReadyForAppEvents = true;
                if (listener != null) {
                    listener.onNodeReady();
                }
            }
        } else {
            if (listener != null) {
                listener.onNodeMessage(channelName, msg);
            }
        }
    }

    public static void init(Context ctx) throws IOException {
        if (instance == null) {
            new NodeJS();
        }
        context = ctx.getApplicationContext();
        assetManager = context.getAssets();

        try {
            Os.setenv("TMPDIR", context.getCacheDir().getAbsolutePath(), true);
        } catch (ErrnoException e) {
            Log.w(LOGTAG, "Failed to set TMPDIR: " + e.getMessage());
        }
        filesDir = context.getFilesDir().getAbsolutePath();

        instance.safeRegisterDataDir(filesDir);

        nodeAppRootAbsolutePath = filesDir + "/" + PROJECT_ROOT;
        nodePath = nodeAppRootAbsolutePath + ":" + filesDir + "/" + BUILTIN_MODULES;
        trashDir = filesDir + "/" + TRASH_DIR;
        nativeAssetsPath = BUILTIN_NATIVE_ASSETS_PREFIX + instance.safeGetAbi();

        final boolean freshInstall = wasAPKUpdated();
        initSemaphore.acquireUninterruptibly();
        try {
            new Thread(() -> {
                try {
                    emptyTrash();
                    if (freshInstall) {
                        copyNodeJSAssets();
                        Log.d(LOGTAG, "NodeJS assets copied (fresh install)");
                    } else {
                        Log.d(LOGTAG, "NodeJS assets preserved (existing install)");
                    }
                    initCompleted = true;
                } catch (IOException e) {
                    initError = e;
                    Log.e(LOGTAG, "Node assets copy failed: " + e.toString());
                }
                initSemaphore.release();
                if (freshInstall) emptyTrash();
            }).start();
        } catch (Exception e) {
            initSemaphore.release();
            throw new IOException("Failed to start init thread", e);
        }
    }

    public static void startEngine(final String scriptFileName) {
        Log.d(LOGTAG, "startEngine: " + scriptFileName);

        if (engineAlreadyStarted) {
            Log.w(LOGTAG, "Engine already started");
            return;
        }

        if (scriptFileName == null || scriptFileName.isEmpty()) {
            Log.e(LOGTAG, "Invalid script filename");
            if (listener != null) listener.onNodeError("Invalid script filename");
            return;
        }

        final String scriptFileAbsolutePath = nodeAppRootAbsolutePath + "/" + scriptFileName;
        Log.d(LOGTAG, "Script absolute path: " + scriptFileAbsolutePath);

        new Thread(() -> {
            waitForInit();

            if (initError != null) {
                Log.e(LOGTAG, "Init failed: " + initError);
                if (listener != null) listener.onNodeError("Init failed: " + initError);
                return;
            }

            synchronized (NodeJS.class) {
                if (engineAlreadyStarted) return;
                engineAlreadyStarted = true;
            }

            File fileObject = new File(scriptFileAbsolutePath);
            if (!fileObject.exists()) {
                Log.e(LOGTAG, "Script not found: " + scriptFileAbsolutePath);
                if (listener != null) listener.onNodeError("Script not found: " + scriptFileAbsolutePath);
                engineAlreadyStarted = false;
                return;
            }

            Log.i(LOGTAG, "Starting Node.js with: " + scriptFileAbsolutePath);
            instance.safeStartNode(
                new String[]{"node", scriptFileAbsolutePath},
                nodePath,
                true
            );
        }).start();
    }

    public static void resumeNode() {
        if (instance != null && engineAlreadyStarted && nodeIsReadyForAppEvents) {
            instance.safeSendToNode(SYSTEM_CHANNEL, "resume");
        }
    }

    public static void pauseNode() {
        if (instance != null && engineAlreadyStarted && nodeIsReadyForAppEvents) {
            instance.safeSendToNode(SYSTEM_CHANNEL, "pause");
        }
    }

    // -- asset helpers --

    private static void waitForInit() {
        if (!initCompleted) {
            initSemaphore.acquireUninterruptibly();
            initSemaphore.release();
        }
    }

    private static boolean wasAPKUpdated() {
        SharedPreferences prefs = context.getSharedPreferences(SHARED_PREFS, Context.MODE_PRIVATE);
        previousLastUpdateTime = prefs.getLong(LAST_UPDATED_TIME, 0);
        try {
            PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            lastUpdateTime = info.lastUpdateTime;
        } catch (PackageManager.NameNotFoundException e) {
            lastUpdateTime = 1;
        }
        return lastUpdateTime != previousLastUpdateTime;
    }

    private static void saveLastUpdateTime() {
        context.getSharedPreferences(SHARED_PREFS, Context.MODE_PRIVATE)
            .edit().putLong(LAST_UPDATED_TIME, lastUpdateTime).commit();
    }

    private static void emptyTrash() {
        File trash = new File(trashDir);
        if (trash.exists()) deleteRecursive(trash);
    }

    private static void copyNodeJSAssets() throws IOException {
        File nodejsBuiltinModulesFolder = new File(filesDir + "/" + BUILTIN_ASSETS);
        if (nodejsBuiltinModulesFolder.exists()) deleteRecursive(nodejsBuiltinModulesFolder);
        copyAssetFolder(BUILTIN_ASSETS, filesDir + "/" + BUILTIN_ASSETS);

        File nodejsProjectFolder = new File(nodeAppRootAbsolutePath);
        if (nodejsProjectFolder.exists()) {
            File trash = new File(trashDir);
            nodejsProjectFolder.renameTo(trash);
        }
        nodejsProjectFolder.mkdirs();

        ArrayList<String> dirs = readAssetLines("dir.list");
        ArrayList<String> files = readAssetLines("file.list");

        if (files.size() > 0) {
            for (String dir : dirs) {
                new File(filesDir + "/" + dir).mkdirs();
            }
            for (String file : files) {
                String dest = filesDir + "/" + file;
                copyAssetFile(file, dest);
            }
        } else {
            copyAssetFolder(PROJECT_ROOT, filesDir + "/" + PROJECT_ROOT);
        }

        copyNativeAssets();
        saveLastUpdateTime();
    }

    private static void copyNativeAssets() throws IOException {
        ArrayList<String> nativeDirs = readAssetLines(nativeAssetsPath + "/dir.list");
        ArrayList<String> nativeFiles = readAssetLines(nativeAssetsPath + "/file.list");
        if (nativeFiles.size() > 0) {
            for (String dir : nativeDirs) {
                new File(nodeAppRootAbsolutePath + "/" + dir).mkdirs();
            }
            for (String file : nativeFiles) {
                String src = nativeAssetsPath + "/" + file;
                String dest = nodeAppRootAbsolutePath + "/" + file;
                copyAssetFile(src, dest);
            }
        }
    }

    private static ArrayList<String> readAssetLines(String filename) {
        ArrayList<String> lines = new ArrayList<>();
        try {
            InputStream is = assetManager.open(filename);
            BufferedReader reader = new BufferedReader(new InputStreamReader(is));
            String line;
            while ((line = reader.readLine()) != null) {
                lines.add(line);
            }
            reader.close();
        } catch (IOException e) {
            // file doesn't exist - ok
        }
        return lines;
    }

    private static void copyAssetFolder(String srcFolder, String destPath) throws IOException {
        String[] files = assetManager.list(srcFolder);
        if (files == null || files.length == 0) {
            copyAssetFile(srcFolder, destPath);
        } else {
            new File(destPath).mkdirs();
            for (String file : files) {
                copyAssetFolder(srcFolder + "/" + file, destPath + "/" + file);
            }
        }
    }

    private static void copyAssetFile(String srcPath, String destPath) throws IOException {
        InputStream in = assetManager.open(srcPath);
        new File(destPath).createNewFile();
        OutputStream out = new FileOutputStream(destPath);
        byte[] buffer = new byte[1024];
        int read;
        while ((read = in.read(buffer)) != -1) {
            out.write(buffer, 0, read);
        }
        in.close();
        out.flush();
        out.close();
    }

    private static void deleteRecursive(File file) {
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) {
                for (File child : children) {
                    deleteRecursive(child);
                }
            }
        }
        file.delete();
    }
}
