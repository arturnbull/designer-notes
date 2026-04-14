#!/usr/bin/env node

// designer-notes setup script
// Deterministic project setup: injects script tags, starts server, creates changelog.
// Called by the PreToolUse hook when /designer-notes is invoked.
//
// Usage: node setup.js <project-dir> [filename.html]
// Output: JSON status to stdout for the hook to relay to Claude.

const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync, spawn } = require('child_process');

const SKILL_DIR = path.join(process.env.HOME, '.claude', 'skills', 'designer-notes');
const DEFAULT_PORT = 3847;
const MAX_PORT_ATTEMPTS = 10;

const projectDir = process.argv[2];
const targetFile = process.argv[3]; // optional specific filename

if (!projectDir) {
  console.error(JSON.stringify({ error: 'No project directory provided' }));
  process.exit(1);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function findHtmlFiles(dir, filename) {
  if (filename) {
    const full = path.join(dir, filename);
    if (fs.existsSync(full)) return [full];
    // Try recursive
    const found = findFilesRecursive(dir, filename);
    return found;
  }
  // Non-recursive first
  const top = fs.readdirSync(dir)
    .filter(f => f.endsWith('.html') && !f.startsWith('.'))
    .map(f => path.join(dir, f));
  if (top.length > 0) return top;
  // Recursive fallback (skip node_modules, .designer-notes, hidden dirs)
  return findFilesRecursive(dir, '*.html');
}

function findFilesRecursive(dir, pattern, depth = 0) {
  if (depth > 4) return [];
  const results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isFile()) {
        if (pattern === '*.html' && entry.name.endsWith('.html')) results.push(full);
        else if (entry.name === pattern) results.push(full);
      } else if (entry.isDirectory()) {
        results.push(...findFilesRecursive(full, pattern, depth + 1));
      }
    }
  } catch (e) { /* skip unreadable dirs */ }
  return results;
}

function injectScript(htmlPath) {
  const content = fs.readFileSync(htmlPath, 'utf8');
  if (content.includes('designer-notes.js')) {
    return { file: path.relative(projectDir, htmlPath), status: 'already-present' };
  }

  const tag = `  <script src="/designer-notes.js"></script>`;

  // Insert before </body>
  const bodyClose = content.lastIndexOf('</body>');
  if (bodyClose === -1) {
    return { file: path.relative(projectDir, htmlPath), status: 'no-body-tag' };
  }

  const updated = content.slice(0, bodyClose) + tag + '\n' + content.slice(bodyClose);
  fs.writeFileSync(htmlPath, updated, 'utf8');
  return { file: path.relative(projectDir, htmlPath), status: 'injected' };
}

function checkPort(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/server-info`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const info = JSON.parse(data);
          resolve({ inUse: true, isDesignerNotes: info.active === true, projectPath: info.projectPath });
        } catch {
          resolve({ inUse: true, isDesignerNotes: false });
        }
      });
    });
    req.on('error', () => resolve({ inUse: false }));
    req.setTimeout(1000, () => { req.destroy(); resolve({ inUse: false }); });
  });
}

async function findAvailablePort() {
  for (let i = 0; i < MAX_PORT_ATTEMPTS; i++) {
    const port = DEFAULT_PORT + i;
    const status = await checkPort(port);
    if (!status.inUse) return { port, existing: false };
    if (status.isDesignerNotes && status.projectPath === projectDir) {
      return { port, existing: true };
    }
  }
  return { port: null, existing: false };
}

async function startServer(port) {
  const serveJs = path.join(SKILL_DIR, 'serve.js');
  const child = spawn('node', [serveJs, projectDir, String(port)], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  // Wait for server to be ready
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 250));
    const status = await checkPort(port);
    if (status.inUse && status.isDesignerNotes) return true;
  }
  return false;
}

function setupChangelog() {
  const dir = path.join(projectDir, '.designer-notes');
  const file = path.join(dir, 'changelog.html');
  if (fs.existsSync(file)) return { status: 'already-exists' };

  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const template = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Changelog</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 14px; line-height: 1.6; color: #1a1a2e; background: #f8fafc; margin: 0; padding: 0; }
    .header { max-width: 720px; margin: 0 auto; padding: 24px 32px; }
    .header h1 { font-size: 18px; font-weight: 600; margin: 0; }
    .filter-bar { border-bottom: 1px solid #e2e8f0; background: #fff; }
    .filter-bar-inner { max-width: 720px; margin: 0 auto; padding: 12px 32px; }
    .filter-bar input { width: 100%; max-width: 320px; padding: 6px 12px; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 13px; font-family: inherit; }
    main { max-width: 720px; margin: 0 auto; padding: 24px 32px; }
    section { margin-bottom: 32px; }
    h2 { font-size: 14px; font-weight: 600; color: #64748b; margin: 0 0 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; table-layout: fixed; }
    th:nth-child(1), td:nth-child(1) { width: 32px; }
    th:nth-child(2), td:nth-child(2) { width: 40%; }
    th:nth-child(3), td:nth-child(3) { width: auto; }
    th:nth-child(4), td:nth-child(4) { width: 90px; }
    th { text-align: left; padding: 6px 8px; font-weight: 600; color: #64748b; border-bottom: 2px solid #e2e8f0; }
    td { padding: 6px 8px; border-bottom: 1px solid #f1f5f9; vertical-align: top; word-wrap: break-word; }
    tr:hover td { background: #f1f5f9; }
    .file { font-family: monospace; font-size: 12px; color: #64748b; }
    @media (max-width: 600px) {
      .header, .filter-bar-inner, main { padding-left: 16px; padding-right: 16px; }
      th:nth-child(4), td:nth-child(4) { display: none; }
      th:nth-child(2), td:nth-child(2) { width: 50%; }
    }
  </style>
</head>
<body>
  <div class="header"><h1>Changelog</h1></div>
  <div class="filter-bar"><div class="filter-bar-inner"><input type="text" placeholder="Filter by date or keyword..." id="filter"></div></div>
  <main>
<!-- SECTIONS -->
  </main>
  <script>
    document.getElementById('filter').addEventListener('input', function(e) {
      var q = e.target.value.toLowerCase();
      document.querySelectorAll('main section').forEach(function(s) {
        s.style.display = s.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
    });
  </script>
</body>
</html>`;

  fs.writeFileSync(file, template, 'utf8');
  return { status: 'created' };
}

function checkConfig() {
  const configPath = path.join(projectDir, 'dn-config.json');
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return { exists: true, preferences: config.preferences || {} };
    } catch {
      return { exists: true, corrupt: true };
    }
  }
  return { exists: false };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const result = {
    projectDir,
    toolFilesPresent: false,
    htmlFiles: [],
    server: {},
    changelog: {},
    config: {},
  };

  // 1. Check tool files exist
  const jsFile = path.join(SKILL_DIR, 'designer-notes.js');
  const serveFile = path.join(SKILL_DIR, 'serve.js');
  result.toolFilesPresent = fs.existsSync(jsFile) && fs.existsSync(serveFile);
  if (!result.toolFilesPresent) {
    console.log(JSON.stringify(result));
    process.exit(0);
  }

  // 2. Find and inject into HTML files
  const htmlFiles = findHtmlFiles(projectDir, targetFile);
  result.htmlFiles = htmlFiles.map(f => injectScript(f));

  // 3. Start or detect server
  const portResult = await findAvailablePort();
  if (portResult.port === null) {
    result.server = { status: 'no-port-available', triedPorts: `${DEFAULT_PORT}-${DEFAULT_PORT + MAX_PORT_ATTEMPTS - 1}` };
  } else if (portResult.existing) {
    result.server = { status: 'already-running', port: portResult.port, url: `http://localhost:${portResult.port}` };
  } else {
    const started = await startServer(portResult.port);
    result.server = {
      status: started ? 'started' : 'failed-to-start',
      port: portResult.port,
      url: `http://localhost:${portResult.port}`,
    };
  }

  // 4. Changelog
  result.changelog = setupChangelog();

  // 5. Config check
  result.config = checkConfig();

  console.log(JSON.stringify(result));
}

main().catch(err => {
  console.error(JSON.stringify({ error: err.message }));
  process.exit(1);
});
