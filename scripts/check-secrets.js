const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const ignoredDirectories = new Set(['.git', 'data', 'dist', 'node_modules']);
const ignoredFiles = new Set(['check-secrets.js', 'package-lock.json']);
const patterns = [
  ['private key', /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/],
  ['AWS access key', /AKIA[0-9A-Z]{16}/],
  ['GitHub token', /gh[pousr]_[A-Za-z0-9_]{20,}/],
  ['assigned secret', /(?:PASSWORD|SECRET|API_KEY|DATABASE_URL)\s*=\s*[^\s"']+/i]
];

function filesIn(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (ignoredDirectories.has(entry.name)) return [];
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? filesIn(fullPath) : [fullPath];
  });
}

const findings = [];
for (const file of filesIn(root)) {
  if (ignoredFiles.has(path.basename(file))) continue;
  const contents = fs.readFileSync(file);
  if (contents.includes(0)) continue;
  const text = contents.toString('utf8');
  for (const [label, pattern] of patterns) if (pattern.test(text)) findings.push(`${path.relative(root, file)}: possible ${label}`);
}

if (findings.length) {
  console.error(findings.join('\n'));
  process.exit(1);
}
console.log('Secret scan passed.');
