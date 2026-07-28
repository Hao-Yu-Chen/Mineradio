@echo off
setlocal enabledelayedexpansion

:: ============================================================
::  Mineradio Android APK Builder (Windows)
::  Usage: build-apk.bat [--release] [--tv]
::  Auto-downloads JDK 17 & Android SDK if missing.
:: ============================================================

:: Go to script directory
cd /d "%~dp0"
set SCRIPT_DIR=%~dp0

set BUILD_TYPE=debug
set TV_MODE=0
set APP_VERSION=2.0.2

:parse_args
if "%~1"=="" goto check_env
if /i "%~1"=="--release" set BUILD_TYPE=release
if /i "%~1"=="--release" shift && goto parse_args
if /i "%~1"=="--tv" set TV_MODE=1
if /i "%~1"=="--tv" shift && goto parse_args
shift
goto parse_args

:: ============================================================
:check_env
:: ============================================================
:: ---- JDK Detection ----
set JAVA_HOME=
if exist "D:\jdk17-temurin\jdk-17.0.12+7\bin\java.exe" set JAVA_HOME=D:\jdk17-temurin\jdk-17.0.12+7
if "!JAVA_HOME!"=="" if exist "D:\jdk21-temurin\jdk-21.0.11+10\bin\java.exe" set JAVA_HOME=D:\jdk21-temurin\jdk-21.0.11+10
if "!JAVA_HOME!"=="" if exist "D:\jdk-17\bin\java.exe" set JAVA_HOME=D:\jdk-17
:: Auto-discover JDK from common install locations
if "!JAVA_HOME!"=="" for /d %%d in ("%ProgramFiles%\Eclipse Adoptium\jdk-17*" "%ProgramFiles%\Eclipse Temurin\jdk-17*" "%ProgramFiles%\Java\jdk-17*" "%ProgramFiles%\Microsoft\jdk-17*") do if exist "%%d\bin\java.exe" set JAVA_HOME=%%d
if "!JAVA_HOME!"=="" for /d %%d in ("%LOCALAPPDATA%\Programs\Eclipse Adoptium\jdk-17*") do if exist "%%d\bin\java.exe" set JAVA_HOME=%%d

:: ---- Android SDK ----
set ANDROID_HOME=D:\android-sdk
set ANDROID_SDK_ROOT=!ANDROID_HOME!

:: ============================================================
:auto_setup_jdk
:: ============================================================
if not "!JAVA_HOME!"=="" goto auto_setup_sdk

echo.
echo [SETUP] JDK 17 not found. Downloading Eclipse Temurin...
echo.
set LOCAL_JDK=!SCRIPT_DIR!jdk
if exist "!LOCAL_JDK!\bin\java.exe" (
    set JAVA_HOME=!LOCAL_JDK!
    echo   Using cached JDK at !LOCAL_JDK!
    goto auto_setup_sdk
)

echo   Downloading JDK 17 from Adoptium...
set JDK_ZIP=!SCRIPT_DIR!jdk_temp.zip
powershell -NoProfile -Command ^
  "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; " ^
  "$url = 'https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse'; " ^
  "$wc = New-Object System.Net.WebClient; " ^
  "Write-Host '  Connecting...'; " ^
  "try { $wc.DownloadFile($url, '!JDK_ZIP!'); Write-Host '  Download complete.' } " ^
  "catch { Write-Host '[ERROR] JDK download failed: ' + $_.Exception.Message; exit 1 }"

if %errorlevel% neq 0 (
    echo   [ERROR] Failed to download JDK. Check your internet connection.
    pause
    exit /b 1
)

echo   Extracting...
powershell -NoProfile -Command ^
  "Expand-Archive -Path '!JDK_ZIP!' -DestinationPath '!SCRIPT_DIR!jdk_extract' -Force; " ^
  "Write-Host '  Extraction done.'"

:: Temurin zip extracts to a subdirectory like jdk-17.0.x+y -- move it up
set LOCAL_JDK_TEMP=!SCRIPT_DIR!jdk_extract
for /d %%d in ("!LOCAL_JDK_TEMP!\*") do (
    if exist "%%d\bin\java.exe" (
        move "%%d" "!LOCAL_JDK!" >nul 2>&1
        goto jdk_extracted
    )
)
:: Fallback: if the zip extracted flat (no subdir), just rename
if exist "!LOCAL_JDK_TEMP!\bin\java.exe" (
    move "!LOCAL_JDK_TEMP!" "!LOCAL_JDK!" >nul 2>&1
) else (
    :: Last resort -- search
    for /d %%d in ("!LOCAL_JDK_TEMP!\*") do if exist "%%d\bin\java.exe" move "%%d" "!LOCAL_JDK!" >nul 2>&1
)

:jdk_extracted
rmdir /s /q "!LOCAL_JDK_TEMP!" >nul 2>&1
del "!JDK_ZIP!" >nul 2>&1

if exist "!LOCAL_JDK!\bin\java.exe" (
    set JAVA_HOME=!LOCAL_JDK!
    echo   JDK 17 ready at !LOCAL_JDK!
) else (
    echo   [ERROR] JDK extraction failed.
    pause
    exit /b 1
)

:: ============================================================
:auto_setup_sdk
:: ============================================================
:: Check if a working SDK exists (has platforms/ or build-tools/)
set SDK_VALID=0
if exist "!ANDROID_HOME!\platforms\android-34" set SDK_VALID=1
if exist "!ANDROID_HOME!\build-tools" set SDK_VALID=1

if "!SDK_VALID!"=="1" goto build_start

:: Try auto-discover from Android Studio
if exist "%LOCALAPPDATA%\Android\Sdk\platforms\android-34" (
    set ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk
    set ANDROID_SDK_ROOT=!ANDROID_HOME!
    set SDK_VALID=1
    echo   Found Android SDK at !ANDROID_HOME!
    goto build_start
)

:: Try C:\Android\sdk
if exist "C:\Android\Sdk\platforms\android-34" (
    set ANDROID_HOME=C:\Android\Sdk
    set ANDROID_SDK_ROOT=!ANDROID_HOME!
    set SDK_VALID=1
    goto build_start
)

echo.
echo [SETUP] Android SDK not found. Downloading...
echo   This may take a few minutes.
echo.

set LOCAL_SDK=!SCRIPT_DIR!sdk
if not exist "!LOCAL_SDK!" mkdir "!LOCAL_SDK!"
set ANDROID_HOME=!LOCAL_SDK!
set ANDROID_SDK_ROOT=!LOCAL_SDK!

:: ---- Download cmdline-tools ----
set CMDLINE_ZIP=!SCRIPT_DIR!cmdline-tools.zip
set CMDLINE_DIR=!LOCAL_SDK!\cmdline-tools\latest

if exist "!CMDLINE_DIR!\bin\sdkmanager.bat" goto install_sdk_packages

echo   [1/2] Downloading Android command-line tools...
powershell -NoProfile -Command ^
  "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; " ^
  "$url = 'https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip'; " ^
  "$wc = New-Object System.Net.WebClient; " ^
  "try { $wc.DownloadFile($url, '!CMDLINE_ZIP!'); Write-Host '  Download complete.' } " ^
  "catch { Write-Host '[ERROR] SDK download failed: ' + $_.Exception.Message; exit 1 }"

if %errorlevel% neq 0 (
    echo   [ERROR] Failed to download Android SDK tools.
    pause
    exit /b 1
)

echo   Extracting...
mkdir "!LOCAL_SDK!\cmdline-tools\latest" >nul 2>&1
powershell -NoProfile -Command ^
  "Expand-Archive -Path '!CMDLINE_ZIP!' -DestinationPath '!LOCAL_SDK!\cmdline-tools\latest' -Force"
del "!CMDLINE_ZIP!" >nul 2>&1

if not exist "!CMDLINE_DIR!\bin\sdkmanager.bat" (
    echo   [ERROR] SDK tools extraction failed.
    pause
    exit /b 1
)

:: ---- Install SDK packages ----
:install_sdk_packages
echo   [2/2] Installing Android SDK packages (platforms, build-tools)...
echo   This may take several minutes...

:: Accept licenses (pipe 'y' to accept all)
(echo y& echo y& echo y& echo y& echo y& echo y& echo y& echo y) | call "!CMDLINE_DIR!\bin\sdkmanager.bat" --sdk_root=!LOCAL_SDK! --licenses >nul 2>nul

:: Install required packages
call "!CMDLINE_DIR!\bin\sdkmanager.bat" --sdk_root=!LOCAL_SDK! ^
  "platforms;android-34" ^
  "build-tools;34.0.0" ^
  "platform-tools" ^
  2>&1

if %errorlevel% neq 0 (
    echo   [WARNING] Some SDK packages may have failed. Trying to continue...
) else (
    echo   SDK packages installed.
)

:: ---- Read version from package.json ----
node -e "require('fs').writeFileSync('_v.txt',require('../package.json').version)" 2>nul
if exist "_v.txt" (
    set /p APP_VERSION=<"_v.txt"
    del "_v.txt" >nul 2>&1
)

:: ============================================================
:build_start
:: ============================================================
:: If we used local SDK, verify we have what we need
if not exist "!ANDROID_HOME!\platforms\android-34" (
    echo   [WARNING] android-34 platform not found. SDK setup may be incomplete.
)

echo.
echo ============================================
echo   Mineradio Android APK Builder  v!APP_VERSION!
echo ============================================
echo.
echo JAVA_HOME:     !JAVA_HOME!
echo ANDROID_HOME:  !ANDROID_HOME!
if "!JAVA_HOME!"=="!LOCAL_JDK!" echo   (auto-downloaded JDK)
if "!ANDROID_HOME!"=="!LOCAL_SDK!" echo   (auto-downloaded SDK)
echo Build type:    !BUILD_TYPE!
if %TV_MODE%==1 echo TV mode:       enabled
echo.

:: ---- Step 1: Prepare web assets ----
echo [1/5] Preparing web assets...
:: Ensure nodejs-mobile assets exist (prevents init crash)
if not exist "android\app\src\main\assets\nodejs-mobile-cordova-assets\builtin_modules" (
    mkdir "android\app\src\main\assets\nodejs-mobile-cordova-assets\builtin_modules" >nul 2>&1
)
type nul > "android\app\src\main\assets\nodejs-mobile-cordova-assets\builtin_modules\.gitkeep" 2>nul
type nul > "android\app\src\main\assets\nodejs-mobile-cordova-assets\.gitkeep" 2>nul
if exist "..\public\" (
    xcopy "..\public\*" "www\" /E /Y /Q >nul 2>&1
    if exist "www\desktop-lyrics.html" del "www\desktop-lyrics.html" >nul 2>&1
    if exist "www\wallpaper.html" del "www\wallpaper.html" >nul 2>&1
    echo   Copied from ..\public\
)

:: ---- Patch index.html for mobile (UTF-8 safe) ----
if exist "www\index.html" (
    powershell -NoProfile -Command ^
      "$f='www\index.html';" ^
      "$utf8=New-Object System.Text.UTF8Encoding($false);" ^
      "$html=[System.IO.File]::ReadAllText((Resolve-Path $f),[System.Text.Encoding]::UTF8);" ^
      "$html=$html -replace 'simple-mode-preload','diy-mode-preload';" ^
      "if($html -notmatch 'mobile-bridge\.js'){$html=$html -replace '(</body>)',('<script src=\"mobile-bridge.js\"></script>'+[Environment]::NewLine+'$1');};" ^
      "[System.IO.File]::WriteAllText((Resolve-Path $f),$html,$utf8);" ^
      "Write-Host '  Mobile patches applied';" 2>&1
)

:: ---- Step 2: Prepare Node.js project ----
echo [2/5] Preparing Node.js project...
if not exist "www\nodejs-project\" mkdir "www\nodejs-project" >nul 2>&1

if not exist "www\nodejs-project\server.js" (
    echo   Copying server.js from parent project...
    copy "..\server.js" "www\nodejs-project\" >nul
    copy "..\lx-source-engine.js" "www\nodejs-project\" >nul
    copy "..\lx-search.js" "www\nodejs-project\" >nul
    copy "..\dj-analyzer.js" "www\nodejs-project\" >nul
    if exist "..\ncm-wrapper.js" copy "..\ncm-wrapper.js" "www\nodejs-project\" >nul 2>nul
    echo   Done
)

:: ---- Step 3: npm install ----
echo [3/5] Installing Capacitor dependencies...
call npm install --silent 2>nul
if errorlevel 1 echo   WARNING: npm install had issues, continuing...

:: ---- Step 4: Capacitor sync ----
echo [4/5] Syncing Capacitor...
call npx cap sync android
if errorlevel 1 (
    echo [ERROR] Capacitor sync failed!
    pause
    exit /b 1
)

:: ---- Step 5: Build APK ----
echo [5/5] Building APK...

:: The Gradle project is in android\android\ (created by npx cap add android)
:: We must cd there because Gradle looks for settings.gradle in the working dir
set "GRADLE_DIR=%~dp0android"
if not exist "!GRADLE_DIR!\gradlew.bat" (
    echo   [ERROR] gradlew.bat not found at !GRADLE_DIR!
    pause
    exit /b 1
)
cd /d "!GRADLE_DIR!"
echo   Working dir: %cd%

if /i "!BUILD_TYPE!"=="release" (
    echo   Running: gradlew assembleRelease
    call gradlew.bat assembleRelease
    set "APK_PATH=!GRADLE_DIR!\app\build\outputs\apk\release\app-release-unsigned.apk"
) else (
    echo   Running: gradlew assembleDebug
    call gradlew.bat assembleDebug
    set "APK_PATH=!GRADLE_DIR!\app\build\outputs\apk\debug\app-debug.apk"
)

if errorlevel 1 (
    echo.
    echo ============================================
    echo   BUILD FAILED - Check errors above
    echo ============================================
    pause
    exit /b 1
)

:: ---- Sign release APK ----
if /i "!BUILD_TYPE!" neq "release" goto skip_sign

echo   Signing release APK...
set "DEBUG_KS=%USERPROFILE%\.android\debug.keystore"

if exist "!DEBUG_KS!" goto sign_apk
echo   Creating debug keystore...
"!JAVA_HOME!\bin\keytool" -genkey -v -keystore "!DEBUG_KS!" -storepass android -alias androiddebugkey -keypass android -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Android Debug,O=Android,C=US" >nul 2>&1

:sign_apk
set "BTOOLS=!ANDROID_HOME!\build-tools\34.0.0"
if not exist "!BTOOLS!\apksigner.bat" set "BTOOLS=!ANDROID_HOME!\build-tools\35.0.0"
if not exist "!BTOOLS!\apksigner.bat" set "BTOOLS=!ANDROID_HOME!\build-tools\33.0.1"

if not exist "!BTOOLS!\apksigner.bat" (
    echo   apksigner not found, using jarsigner...
    "!JAVA_HOME!\bin\jarsigner" -keystore "!DEBUG_KS!" -storepass android -keypass android -sigalg SHA256withRSA -digestalg SHA-256 -signedjar "!APK_PATH!.tmp" "!APK_PATH!" androiddebugkey
    if %errorlevel% neq 0 goto sign_fail
    copy /Y "!APK_PATH!.tmp" "!APK_PATH!" >nul
    del "!APK_PATH!.tmp" >nul
    echo   Signing done.
    goto skip_sign
)

echo   Aligning and signing...
"!BTOOLS!\zipalign" -p -f 4 "!APK_PATH!" "!APK_PATH!.aligned"
if exist "!APK_PATH!.aligned" (
    del "!APK_PATH!" >nul 2>&1
    move "!APK_PATH!.aligned" "!APK_PATH!" >nul 2>&1
)
call "!BTOOLS!\apksigner.bat" sign --ks "!DEBUG_KS!" --ks-pass pass:android --ks-key-alias androiddebugkey --key-pass pass:android "!APK_PATH!"
if %errorlevel% equ 0 (
    echo   Signing done.
) else (
    echo   [WARNING] apksigner failed, trying jarsigner...
    "!JAVA_HOME!\bin\jarsigner" -keystore "!DEBUG_KS!" -storepass android -keypass android -sigalg SHA256withRSA -digestalg SHA-256 "!APK_PATH!" androiddebugkey >nul 2>&1
    echo   Signed with jarsigner.
)
goto skip_sign

:sign_fail
echo   [WARNING] Signing failed, trying unsigned APK...

:skip_sign

:: ---- Output ----
if exist "!APK_PATH!" (
    set "OUTPUT=%~dp0Mineradio-v!APP_VERSION!-!BUILD_TYPE!.apk"
    copy "!APK_PATH!" "!OUTPUT!" >nul
    echo.
    echo ============================================
    echo   BUILD SUCCESSFUL!
    echo   APK: !OUTPUT!
    echo ============================================
) else (
    echo.
    echo ============================================
    echo   BUILD FAILED
    echo   APK not found: !APK_PATH!
    echo ============================================
    pause
    exit /b 1
)

endlocal
