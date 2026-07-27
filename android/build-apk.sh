#!/bin/bash
# Mineradio Android APK Build Script
# Usage: bash build-apk.sh [--release] [--tv]
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# ── Environment (MUST use JDK 17+ for Android Gradle Plugin 8.x) ──
# Check for JDK 17 in common locations
for jdk_candidate in "/d/jdk17-temurin/jdk-17.0.12+7" "/d/jdk21-temurin/jdk-21.0.11+10" "/d/jdk-17"; do
  if [ -f "$jdk_candidate/bin/java" ]; then
    export JAVA_HOME="$jdk_candidate"
    break
  fi
done
if [ -z "$JAVA_HOME" ] || [ ! -f "$JAVA_HOME/bin/java" ]; then
  echo "ERROR: JDK 17+ not found. Please install JDK 17 or set JAVA_HOME."
  echo "  Tried: /d/jdk17-temurin/jdk-17.0.12+7, /d/jdk21-temurin/jdk-21.0.11+10, /d/jdk-17"
  exit 1
fi
export ANDROID_HOME="${ANDROID_HOME:-/d/android-sdk}"
export ANDROID_SDK_ROOT="${ANDROID_HOME}"

echo "============================================"
echo " Mineradio Android APK Builder"I
echo "============================================"
echo ""
echo "JAVA_HOME:     $JAVA_HOME"
echo "ANDROID_HOME:  $ANDROID_HOME"
echo ""

# Check environment
if [ ! -d "$JAVA_HOME" ]; then
    echo "ERROR: JAVA_HOME not found: $JAVA_HOME"
    echo "  Expected JDK at D:\\jdk17-temurin"
    exit 1
fi
if [ ! -d "$ANDROID_HOME" ]; then
    echo "ERROR: ANDROID_HOME not found: $ANDROID_HOME"
    echo "  Expected Android SDK at D:\\android-sdk"
    exit 1
fi

BUILD_TYPE="debug"
TV_MODE=""

for arg in "$@"; do
    case $arg in
        --release) BUILD_TYPE="release" ;;
        --tv) TV_MODE="tv" ;;
    esac
done

echo "Build type: $BUILD_TYPE"
[ "$TV_MODE" = "tv" ] && echo "TV mode: enabled"
echo ""

# ── Ensure nodejs-mobile assets exist (prevents init crash) ──
NMA_DIR="android/app/src/main/assets/nodejs-mobile-cordova-assets/builtin_modules"
mkdir -p "$NMA_DIR"
echo "placeholder" > "$NMA_DIR/__nodejs_mobile_placeholder__"

# ── Prepare web assets ──
echo "[1/5] Preparing web assets..."
if [ -d "../public" ]; then
    # Copy frontend files
    cp -r ../public/* www/ 2>/dev/null || true
    # Remove desktop-specific files
    rm -f www/desktop-lyrics.html www/wallpaper.html 2>/dev/null || true
    echo "  Frontend files copied from ../public/"
else
    echo "  WARNING: ../public/ not found, using existing www/"
fi

# Patch the REAL index.html for mobile (save as app.html)
if [ -f "www/index.html" ]; then
    # 1. Change preload CSS class to DIY mode
    sed -i "s/'simple-mode-preload'/'diy-mode-preload'/g" www/index.html
    # 2. Also set localStorage in preload so main script reads DIY mode correctly
    sed -i "0,/try {/s|try {|try { localStorage.setItem('mineradio-diy-player-mode-v1','1');|" www/index.html
    # 3. Inject mobile bridge
    if ! grep -q "mobile-bridge.js" www/index.html; then
        sed -i 's|</body>|<script src="mobile-bridge.js"></script>\n</body>|' www/index.html
    fi
    echo "  Mobile: DIY mode + bridge injected into index.html"
    echo "  Mobile bridge injected into index.html"
fi

# ── Patch incompatible npm packages ──
echo "[pre] Patching npm packages for Node.js Mobile compatibility..."
NODE_MODULES="www/nodejs-project/node_modules"

# Fix 1: mpg123-decoder - remove "type":"module" (require() doesn't support ESM)
if [ -f "$NODE_MODULES/mpg123-decoder/package.json" ]; then
  # Remove "type":"module" to allow require()
  sed -i 's/"type"\s*:\s*"module"\s*,//g; s/"type"\s*:\s*"module"//g' "$NODE_MODULES/mpg123-decoder/package.json"
  echo "  mpg123-decoder patched (removed type:module)"
fi

# Fix 2: Check for other ESM packages and patch them
for pkg in "$NODE_MODULES"/@eshaz/* "$NODE_MODULES"/simple-yenc "$NODE_MODULES"/@wasm-audio-decoders/*; do
  if [ -f "$pkg/package.json" ]; then
    sed -i 's/"type"\s*:\s*"module"\s*,//g; s/"type"\s*:\s*"module"//g' "$pkg/package.json" 2>/dev/null
  fi
done

# Fix 3: NeteaseCloudMusicApi - pin compatible version
if ! grep -q '4.16.0' "$NODE_MODULES/NeteaseCloudMusicApi/package.json" 2>/dev/null; then
  echo "  Installing NeteaseCloudMusicApi@4.16.0 (compatible version)..."
  (cd "www/nodejs-project" && npm install NeteaseCloudMusicApi@4.16.0 --save --silent 2>&1) || echo "  WARNING: Netease version change may need manual fix"
fi

echo "  Patching done"

# ── Prepare Node.js project ──
echo "[2/5] Preparing Node.js project..."
NODE_DIR="www/nodejs-project"
if [ ! -f "$NODE_DIR/server.js" ]; then
    echo "  WARNING: server.js not found in www/nodejs-project/"
    echo "  Copying from parent project..."
    mkdir -p "$NODE_DIR"
    cp ../server.js "$NODE_DIR/"
    cp ../lx-source-engine.js "$NODE_DIR/"
    cp ../lx-search.js "$NODE_DIR/"
    cp ../dj-analyzer.js "$NODE_DIR/"
fi

# Install Node.js dependencies if needed
if [ ! -d "$NODE_DIR/node_modules" ]; then
    echo "  Installing Node.js dependencies..."
    (cd "$NODE_DIR" && npm install --production 2>&1 | tail -3) || echo "  WARNING: npm install may have failed"
fi

# ── NPM install ──
echo "[3/5] Installing Capacitor dependencies..."
npm install --silent 2>&1 | tail -3 || true

# ── Capacitor sync ──
echo "[4/5] Syncing Capacitor..."
npx cap sync android 2>&1

# ── Build APK ──
echo "[5/5] Building APK..."
cd android

if [ "$BUILD_TYPE" = "release" ]; then
    ./gradlew assembleRelease 2>&1
    APK_PATH="app/build/outputs/apk/release/app-release.apk"
else
    ./gradlew assembleDebug 2>&1
    APK_PATH="app/build/outputs/apk/debug/app-debug.apk"
fi

# ── Result ──
cd "$SCRIPT_DIR"
if [ -f "android/$APK_PATH" ]; then
    OUTPUT="Mineradio-${BUILD_TYPE}.apk"
    cp "android/$APK_PATH" "$OUTPUT"
    SIZE=$(du -h "$OUTPUT" | cut -f1)
    echo ""
    echo "============================================"
    echo " BUILD SUCCESSFUL!"
    echo " APK: $(pwd)/$OUTPUT"
    echo " Size: $SIZE"
    echo "============================================"
else
    echo ""
    echo "============================================"
    echo " BUILD FAILED"
    echo " Check the output above for errors."
    echo "============================================"
    exit 1
fi
