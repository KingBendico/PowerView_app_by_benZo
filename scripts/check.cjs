const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
let count = 0;
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.(?:js|cjs)$/.test(entry.name)) { execFileSync(process.execPath, ['--check', file]); count++; }
  }
}
for (const dir of ['src', 'scripts', 'test']) walk(path.join(root, dir));
const html = fs.readFileSync(path.join(root, 'views/index.html'), 'utf8');
for (const match of html.matchAll(/(?:src|href)="(\.\.\/[^"#]+)"/g)) {
  if (!fs.existsSync(path.resolve(root, 'views', match[1]))) throw new Error(`Missing UI resource: ${match[1]}`);
}
console.log(`Syntax checked ${count} JavaScript files; UI resources resolved.`);
