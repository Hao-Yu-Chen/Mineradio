try {
  var b = require('@babel/standalone');
  console.log('Babel version:', b.version);

  // Test transpilation
  var testCode = 'var x = obj?.prop?.nested ?? "default";';
  var result = b.transform(testCode, {
    presets: [['env', { targets: { node: '12.19.0' }, modules: false }]],
    compact: false,
  });
  console.log('Input:', testCode);
  console.log('Output:', result.code);
} catch(e) {
  console.log('FAIL:', e.message);
}
