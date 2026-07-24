// Patch ESM packages to work with Node.js require()
var fs = require('fs');
var path = require('path');
var base = __dirname;

var targets = [
  'node_modules/mpg123-decoder/package.json',
  'node_modules/@eshaz/web-worker/package.json',
  'node_modules/simple-yenc/package.json',
  'node_modules/@wasm-audio-decoders/common/package.json',
];

targets.forEach(function(t) {
  var p = path.join(base, t);
  if (fs.existsSync(p)) {
    var c = fs.readFileSync(p, 'utf8');
    // Remove "type": "module" (with or without trailing comma)
    c = c.replace(/"type"\s*:\s*"module"\s*,?/g, '');
    c = c.replace(/,\s*}/g, '}'); // clean trailing commas
    fs.writeFileSync(p, c);
    console.log('Patched: ' + t);
  }
});
console.log('ESM patching complete');
