const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
fs.cpSync(path.join(root, 'public'), path.join(output, 'public'), { recursive: true });
for (const file of ['server.js', 'package.json']) fs.copyFileSync(path.join(root, file), path.join(output, file));

for (const required of ['public/index.html', 'public/styles.css', 'public/app.js', 'server.js', 'package.json']) {
  if (!fs.existsSync(path.join(output, required))) throw new Error(`Build is missing ${required}`);
}
console.log('Build created in dist/.');
