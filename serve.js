#!/usr/bin/env node

// designer-notes dev server
// Serves static files + saves feedback markdown to the project folder.
// Usage: node serve.js [project-path] [port]
//   project-path: where feedback .md files land (default: cwd)
//   port: server port (default: 3847)

const http = require('http');
const fs = require('fs');
const path = require('path');

const projectPath = process.argv[2] || process.cwd();
const preferredPort = parseInt(process.argv[3]) || 3847;
let clearSignal = false;

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

const server = http.createServer((req, res) => {
  // CORS for local dev
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Body size cap for all POST endpoints
  const MAX_BODY = 1048576; // 1 MB

  // POST /save-feedback — write markdown to project folder
  if (req.method === 'POST' && req.url === '/save-feedback') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > MAX_BODY) { req.destroy(); return; } });
    req.on('end', () => {
      try {
        let parsed;
        try { parsed = JSON.parse(body); } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
          return;
        }
        const { filename, content } = parsed;
        if (!filename || !content) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing filename or content' }));
          return;
        }

        // Sanitize filename
        const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 255);
        const filePath = path.join(projectPath, safe);
        fs.writeFileSync(filePath, content, 'utf8');

        console.log(`\x1b[32m✓\x1b[0m Saved feedback → ${filePath}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ path: filePath }));
      } catch (e) {
        console.error('Save error:', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // POST /archive-feedback — move feedback file to archive + signal client to clear
  if (req.method === 'POST' && req.url === '/archive-feedback') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > MAX_BODY) { req.destroy(); return; } });
    req.on('end', () => {
      try {
        const today = new Date().toISOString().substring(0, 10);
        const feedbackFile = path.join(projectPath, `feedback-${today}.md`);
        const archiveFile = path.join(projectPath, `feedback-archive.md`);

        if (!fs.existsSync(feedbackFile)) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No feedback file found' }));
          return;
        }

        const feedbackContent = fs.readFileSync(feedbackFile, 'utf8');
        const archiveEntry = '\n\n---\n\n' +
          `# Archived: ${new Date().toISOString().replace('T', ' ').substring(0, 19)}\n\n` +
          feedbackContent;

        // Append to archive (create if doesn't exist)
        if (fs.existsSync(archiveFile)) {
          fs.appendFileSync(archiveFile, archiveEntry, 'utf8');
        } else {
          fs.writeFileSync(archiveFile, '# Feedback Archive\n' + archiveEntry, 'utf8');
        }

        // Remove the active feedback file
        fs.unlinkSync(feedbackFile);

        // Set clear signal for the client
        clearSignal = true;

        console.log(`\x1b[33m⤵\x1b[0m Archived feedback → ${archiveFile}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ archived: archiveFile }));
      } catch (e) {
        console.error('Archive error:', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // POST /save-config — update preferences in dn-config.json
  if (req.method === 'POST' && req.url === '/save-config') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > MAX_BODY) { req.destroy(); return; } });
    req.on('end', () => {
      try {
        const updates = JSON.parse(body);
        const configFile = path.join(projectPath, 'dn-config.json');
        let config = { skills: [], directives: [], preferences: {} };
        if (fs.existsSync(configFile)) {
          config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
        }
        if (updates.preferences) {
          config.preferences = Object.assign(config.preferences || {}, updates.preferences);
        }
        fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n', 'utf8');
        console.log(`\x1b[32m✓\x1b[0m Config updated`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ saved: true }));
      } catch (e) {
        console.error('Config save error:', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // GET /clear-signal — client polls this to know when to reset after submission
  if (req.method === 'GET' && req.url === '/clear-signal') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (clearSignal) {
      clearSignal = false;
      res.end(JSON.stringify({ clear: true }));
    } else {
      res.end(JSON.stringify({ clear: false }));
    }
    return;
  }

  // GET /config — serve dn-config.json for skills list and preferences
  if (req.method === 'GET' && req.url === '/config') {
    const configFile = path.join(projectPath, 'dn-config.json');
    if (fs.existsSync(configFile)) {
      try {
        const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(config));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid config: ' + e.message }));
      }
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ skills: [], preferences: {} }));
    }
    return;
  }

  // GET /server-info — lets the commenter script detect the server
  if (req.method === 'GET' && req.url === '/server-info') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ active: true, projectPath }));
    return;
  }

  // Static file serving
  let filePath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  filePath = path.resolve(projectPath, filePath.replace(/^\//, ''));

  // Path traversal protection
  if (!filePath.startsWith(path.resolve(projectPath))) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(filePath);
  const contentType = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found: ' + req.url);
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

function tryListen(port, maxAttempts) {
  server.listen(port, () => {
    console.log(`\n  \x1b[1mdesigner-notes server\x1b[0m`);
    console.log(`  Local:    \x1b[36mhttp://localhost:${port}\x1b[0m`);
    console.log(`  Feedback: \x1b[33m${projectPath}\x1b[0m\n`);
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && maxAttempts > 1) {
      console.log(`  Port ${port} in use, trying ${port + 1}...`);
      server.removeAllListeners('error');
      tryListen(port + 1, maxAttempts - 1);
    } else {
      console.error(`  Error: ${err.message}`);
      process.exit(1);
    }
  });
}
tryListen(preferredPort, 10);
