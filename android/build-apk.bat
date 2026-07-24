@echo off
setlocal

:: ============================================================
::  Mineradio Android APK Builder (Windows)
::  Usage: build-apk.bat [--release] [--tv]
:: ============================================================

set BUILD_TYPE=debug
set TV_MODE=0

:parse_args
if "%~1"=="" goto check_env
if /i "%~1"=="--release" set BUILD_TYPE=release
if /i "%~1"=="--release" shift && goto parse_args
if /i "%~1"=="--tv" set TV_MODE=1
if /i "%~1"=="--tv" shift && goto parse_args
shift
goto parse_args

:check_env
:: ---- JDK Detection ----
set JAVA_HOME=
if exist "D:\jdk17-temurin\jdk-17.0.12+7\bin\java.exe" set JAVA_HOME=D:\jdk17-temurin\jdk-17.0.12+7
if "%JAVA_HOME%"=="" if exist "D:\jdk21-temurin\jdk-21.0.11+10\bin\java.exe" set JAVA_HOME=D:\jdk21-temurin\jdk-21.0.11+10
if "%JAVA_HOME%"=="" if exist "D:\jdk-17\bin\java.exe" set JAVA_HOME=D:\jdk-17
if "%JAVA_HOME%"=="" (
    echo [ERROR] JDK 17+ not found!
    echo   Tried:
    echo     D:\jdk17-temurin\jdk-17.0.12+7
    echo     D:\jdk21-temurin\jdk-21.0.11+10
    echo     D:\jdk-17
    pause
    exit /b 1
)

:: ---- Android SDK ----
set ANDROID_HOME=D:\android-sdk
set ANDROID_SDK_ROOT=%ANDROID_HOME%

echo ============================================
echo   Mineradio Android APK Builder
echo ============================================
echo.
echo JAVA_HOME:     %JAVA_HOME%
echo ANDROID_HOME:  %ANDROID_HOME%
echo Build type:    %BUILD_TYPE%
if %TV_MODE%==1 echo TV mode:       enabled
echo.

:: ---- Go to script directory ----
cd /d "%~dp0"

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

:: ---- Inject mobile bridge into index.html ----
if exist "www\index.html" (
    powershell -NoProfile -Command ^
      "$html = Get-Content 'www\index.html' -Raw; " ^
      "$tag = '<script src=\"mobile-bridge.js\"></script>'; " ^
      "if ($html -notmatch 'mobile-bridge\.js') { $html = $html -replace '(</body>)', ($tag + '$1'); Set-Content -Path 'www\index.html' -Value $html -NoNewline; Write-Host '  Mobile bridge injected' }" 2>&1
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
if not exist "%GRADLE_DIR%\gradlew.bat" (
    echo   [ERROR] gradlew.bat not found at %GRADLE_DIR%
    pause
    exit /b 1
)
cd /d "%GRADLE_DIR%"
echo   Working dir: %cd%

if /i "%BUILD_TYPE%"=="release" (
    echo   Running: gradlew assembleRelease
    call gradlew.bat assembleRelease
    set "APK_PATH=%GRADLE_DIR%\app\build\outputs\apk\release\app-release.apk"
) else (
    echo   Running: gradlew assembleDebug
    call gradlew.bat assembleDebug
    set "APK_PATH=%GRADLE_DIR%\app\build\outputs\apk\debug\app-debug.apk"
)

if errorlevel 1 (
    echo.
    echo ============================================
    echo   BUILD FAILED - Check errors above
    echo ============================================
    pause
    exit /b 1
)

:: ---- Output ----
if exist "%APK_PATH%" (
    set "OUTPUT=%~dp0Mineradio-%BUILD_TYPE%.apk"
    copy "%APK_PATH%" "%OUTPUT%" >nul
    echo.
    echo ============================================
    echo   BUILD SUCCESSFUL!
    echo   APK: %OUTPUT%
    echo ============================================
) else (
    echo.
    echo ============================================
    echo   BUILD FAILED
    echo   APK not found: %APK_PATH%
    echo ============================================
    pause
    exit /b 1
)

endlocal
