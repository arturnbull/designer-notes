#!/usr/bin/env node

// designer-notes update checker
// Checks npm registry for newer version. Prints JSON if update available, nothing otherwise.
// Usage: node check-update.js [version-file-path]
// Default version file: .version in the same directory as this script.
// Exit code is always 0 — this is advisory, never a failure.

const https = require('https');
const fs = require('fs');
const path = require('path');

const versionFile = process.argv[2] || path.join(__dirname, '.version');
let installed;
try { installed = fs.readFileSync(versionFile, 'utf8').trim(); } catch { process.exit(0); }
if (!installed) process.exit(0);

const req = https.get('https://registry.npmjs.org/designer-notes/latest', {
  headers: { 'Accept': 'application/json' },
  timeout: 2000,
}, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    try {
      const latest = JSON.parse(data).version;
      if (latest && latest !== installed) {
        console.log(JSON.stringify({ installed, latest, command: 'npx designer-notes@latest --force' }));
      }
    } catch { /* silent */ }
  });
});
req.on('error', () => {});
req.on('timeout', () => { req.destroy(); });
