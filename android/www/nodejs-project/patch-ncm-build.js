// patch-ncm-build.js — Build-time NCM patching
// Patches NeteaseCloudMusicApi source files to avoid /tmp/anonymous_token EACCES
// on Android where os.tmpdir() points to the unwritable /tmp.
// This runs BEFORE the APK is assembled so patched files are bundled.
//
// v2: fallback path uses __dirname (NCM module directory) instead of
// os.homedir() because on some Android devices homedir() returns /data
// which is not writable. __dirname is always inside the app's data dir.

var fs = require('fs');
var path = require('path');

var ncmDir = path.join(__dirname, 'node_modules', 'NeteaseCloudMusicApi');
if (!fs.existsSync(ncmDir)) {
    console.log('[PATCH-NCM] NCM not found, skipping');
    process.exit(0);
}

// The replacement uses __dirname (which is inside the app's writable data
// directory on Android) instead of os.homedir() (which may be /data).
var safeTmp =
    'var tmpPath;try{var _td=require("os").tmpdir();' +
    'var _tf=require("path").join(_td,".ncm_rw_test");' +
    'require("fs").writeFileSync(_tf,"x");require("fs").unlinkSync(_tf);' +
    'tmpPath=_td;}catch(_e){tmpPath=require("path").join(' +
    '__dirname,"..",".ncm-cache");' +
    'require("fs").mkdirSync(tmpPath,{recursive:true});' +
    'try{require("fs").writeFileSync(require("path").join(tmpPath,"anonymous_token"),"","utf-8");}catch(_f){}}';

// Two possible targets: NCM v4.8-4.16 uses double quotes, v4.32+ uses single
var targets = [
    'const tmpPath = require("os").tmpdir()',
    "const tmpPath = require('os').tmpdir()",
];

var files = [
    'main.js',
    'app.js',
    'generateConfig.js',
    'util' + path.sep + 'request.js',
];

var patched = 0, skipped = 0, missing = 0;

files.forEach(function(f) {
    var fp = path.join(ncmDir, f);
    if (!fs.existsSync(fp)) {
        console.log('[PATCH-NCM] NOT FOUND: ' + f + ' — skipping');
        missing++;
        return;
    }
    var content = fs.readFileSync(fp, 'utf8');
    // Skip if already patched with v2 fallback (uses __dirname, not homedir)
    if (content.indexOf('.ncm-cache') >= 0) {
        console.log('[PATCH-NCM] Already patched (v2): ' + f);
        skipped++;
        return;
    }
    var matchedTarget = null;
    for (var ti = 0; ti < targets.length; ti++) {
        if (content.indexOf(targets[ti]) >= 0) { matchedTarget = targets[ti]; break; }
    }
    if (!matchedTarget) {
        console.warn('[PATCH-NCM] Target string not found in: ' + f + ' — unexpected format');
        missing++;
        return;
    }
    // Replace ALL occurrences (v1 patch used ncm_rw_test, v2 also adds .ncm-cache)
    var patchedContent = content.split(matchedTarget).join(safeTmp);
    if (patchedContent !== content) {
        fs.writeFileSync(fp, patchedContent);
        console.log('[PATCH-NCM] PATCHED: ' + f);
        patched++;
    } else {
        console.log('[PATCH-NCM] No change: ' + f);
        skipped++;
    }
});

console.log('[PATCH-NCM] Done — patched:' + patched + ' skipped:' + skipped + ' missing:' + missing);
