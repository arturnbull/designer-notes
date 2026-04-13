#!/usr/bin/env node

'use strict';

var fs = require('fs');
var path = require('path');
var os = require('os');

var VERSION = require('../package.json').version;
var SKILLS_SOURCE = path.join(__dirname, '..', 'skills');
var TOOLS_SOURCE = path.join(__dirname, '..');
var CLAUDE_DIR = path.join(os.homedir(), '.claude');
var SKILLS_DEST = path.join(CLAUDE_DIR, 'skills');

var TOOL_FILES = ['designer-notes.js', 'serve.js', 'changelog-template.html'];
var SKILL_DIRS = ['designer-notes', 'submit-feedback'];

// ── Parse args ──────────────────────────────────────────────

var args = process.argv.slice(2);
var force = args.includes('--force') || args.includes('-f');

if (args.includes('--version') || args.includes('-v')) {
  console.log(VERSION);
  process.exit(0);
}

if (args.includes('--help') || args.includes('-h')) {
  console.log([
    '',
    '  designer-notes v' + VERSION,
    '',
    '  Install Claude Code skills for designer-notes.',
    '',
    '  Usage:',
    '    npx designer-notes          Install skills',
    '    npx designer-notes --force   Overwrite existing install',
    '    npx designer-notes --version Show version',
    '    npx designer-notes --help    Show this help',
    '',
    '  Files are installed to ~/.claude/skills/',
    ''
  ].join('\n'));
  process.exit(0);
}

// ── Helpers ─────────────────────────────────────────────────

function copyDir(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  var entries = fs.readdirSync(src, { withFileTypes: true });
  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    var srcPath = path.join(src, entry.name);
    var destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function fileExists(p) {
  try { return fs.statSync(p).isFile(); } catch (e) { return false; }
}

function dirExists(p) {
  try { return fs.statSync(p).isDirectory(); } catch (e) { return false; }
}

// ── Preflight checks ────────────────────────────────────────

console.log('\n  designer-notes v' + VERSION + '\n');

if (!dirExists(CLAUDE_DIR)) {
  console.error('  Error: ~/.claude/ does not exist.');
  console.error('  Install Claude Code first: https://claude.ai/code\n');
  process.exit(1);
}

// Check if already installed
var alreadyInstalled = dirExists(path.join(SKILLS_DEST, 'designer-notes'));
if (alreadyInstalled && !force) {
  // Check installed version
  var versionFile = path.join(SKILLS_DEST, 'designer-notes', '.version');
  var installedVersion = fileExists(versionFile)
    ? fs.readFileSync(versionFile, 'utf8').trim()
    : 'unknown';

  if (installedVersion === VERSION) {
    console.log('  Already installed (v' + VERSION + ').');
    console.log('  Run with --force to reinstall.\n');
    process.exit(0);
  } else {
    console.log('  Updating v' + installedVersion + ' → v' + VERSION + '...\n');
  }
}

// ── Install ─────────────────────────────────────────────────

if (!dirExists(SKILLS_DEST)) {
  fs.mkdirSync(SKILLS_DEST, { recursive: true });
  console.log('  Created ' + SKILLS_DEST);
}

// Copy skill directories
var errors = [];
SKILL_DIRS.forEach(function (name) {
  var src = path.join(SKILLS_SOURCE, name);
  var dest = path.join(SKILLS_DEST, name);
  try {
    copyDir(src, dest);
    console.log('  \u2713 ' + name + ' skill installed');
  } catch (e) {
    errors.push(name + ' skill: ' + e.message);
    console.log('  \u2717 ' + name + ' skill failed: ' + e.message);
  }
});

// Copy tool files into the designer-notes skill directory
var toolDest = path.join(SKILLS_DEST, 'designer-notes');
TOOL_FILES.forEach(function (name) {
  var src = path.join(TOOLS_SOURCE, name);
  try {
    fs.copyFileSync(src, path.join(toolDest, name));
    console.log('  \u2713 ' + name + ' copied');
  } catch (e) {
    errors.push(name + ': ' + e.message);
    console.log('  \u2717 ' + name + ' failed: ' + e.message);
  }
});

// Write version marker
try {
  fs.writeFileSync(path.join(toolDest, '.version'), VERSION + '\n');
} catch (e) { /* non-critical */ }

// ── Report ──────────────────────────────────────────────────

if (errors.length > 0) {
  console.log('\n  Completed with ' + errors.length + ' error(s).\n');
  process.exit(1);
}

console.log([
  '',
  '  Done! Next steps:',
  '',
  '    1. Open Claude Code in any project',
  '    2. Run /designer-notes to wire up your HTML page',
  '    3. Press C to start commenting',
  '    4. Run /submit-feedback to apply your notes',
  ''
].join('\n'));
