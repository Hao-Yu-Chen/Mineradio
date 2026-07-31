#!/bin/bash
set -e
# Resolve script directory regardless of where it's called from
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NODE_DIR="$SCRIPT_DIR"
cd "$NODE_DIR"

echo "=== Patching mpg123-decoder ==="
P="$NODE_DIR/node_modules/mpg123-decoder/package.json"
if [ -f "$P" ]; then
  sed -i 's/"type"\s*:\s*"module"\s*,//g; s/,\s*"type"\s*:\s*"module"//g; s/"type"\s*:\s*"module"//g' "$P"
  echo "Patched mpg123-decoder"
fi

# Also patch sub-dependencies
for sub in "$NODE_DIR/node_modules/@eshaz/web-worker" "$NODE_DIR/node_modules/simple-yenc" "$NODE_DIR/node_modules/@wasm-audio-decoders/common"; do
  SP="$sub/package.json"
  if [ -f "$SP" ]; then
    sed -i 's/"type"\s*:\s*"module"\s*,//g; s/,\s*"type"\s*:\s*"module"//g; s/"type"\s*:\s*"module"//g' "$SP"
    echo "Patched $(basename $(dirname $sub))/$(basename $sub)"
  fi
done

echo "=== Installing NeteaseCloudMusicApi@4.16.0 ==="
npm install NeteaseCloudMusicApi@4.16.0 --save 2>&1

echo "=== Done ==="
echo "Netease version: $(node -e 'console.log(require("./node_modules/NeteaseCloudMusicApi/package.json").version)')"
echo "mpg123 type field: $(node -e 'var p=require("./node_modules/mpg123-decoder/package.json"); console.log(p.type || "not present")')"
