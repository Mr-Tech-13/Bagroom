const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const ignored = new Set(['.git', 'data', 'dist', 'node_modules']);
const checkedExtensions = new Set(['.js', '.json', '.html', '.css', '.md', '.yml', '.yaml']);
const errors = [];

function filesIn(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (ignored.has(entry.name)) return [];
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? filesIn(fullPath) : [fullPath];
  });
}

for (const file of filesIn(root).filter((entry) => checkedExtensions.has(path.extname(entry)))) {
  const relative = path.relative(root, file);
  const contents = fs.readFileSync(file, 'utf8');
  contents.split('\n').forEach((line, index) => {
    if (/\s+$/.test(line)) errors.push(`${relative}:${index + 1} has trailing whitespace`);
  });
  if (path.extname(file) === '.json') {
    try { JSON.parse(contents); } catch (error) { errors.push(`${relative}: invalid JSON (${error.message})`); }
  }
  if (path.extname(file) === '.js') {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) errors.push(`${relative}: ${result.stderr.trim()}`);
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('Lint passed.');
