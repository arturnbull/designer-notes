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

var TOOL_FILES = ['designer-notes.js', 'serve.js', 'setup.js', 'hook.sh', 'changelog-template.html'];
var SKILL_DIRS = ['designer-notes', 'submit-feedback'];

// Cursor-specific paths
var CURSOR_DIR = path.join(os.homedir(), '.cursor');
var CURSOR_DEST = path.join(CURSOR_DIR, 'designer-notes');
var CURSOR_TOOL_FILES = ['designer-notes.js', 'serve.js', 'setup-cursor.js', 'changelog-template.html'];
var CURSOR_COMMANDS_SOURCE = path.join(__dirname, '..', 'cursor', 'commands');

// ── Parse args ──────────────────────────────────────────────

var args = process.argv.slice(2);
var force = args.includes('--force') || args.includes('-f');
var cursorOnly = args.includes('--cursor');
var claudeOnly = args.includes('--claude');

if (args.includes('--version') || args.includes('-v')) {
  console.log(VERSION);
  process.exit(0);
}

if (args.includes('--help') || args.includes('-h')) {
  console.log([
    '',
    '  designer-notes v' + VERSION,
    '',
    '  Install skills and commands for designer-notes.',
    '',
    '  Usage:',
    '    npx designer-notes           Auto-detect editor and install',
    '    npx designer-notes --claude   Install for Claude Code only',
    '    npx designer-notes --cursor   Install for Cursor only',
    '    npx designer-notes --force    Overwrite existing install',
    '    npx designer-notes --version  Show version',
    '    npx designer-notes --help     Show this help',
    '',
    '  Claude Code: files installed to ~/.claude/skills/',
    '  Cursor: tool files to ~/.cursor/designer-notes/,',
    '          commands to <project>/.cursor/commands/',
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

// Auto-detect editors if no flag specified
var installClaude = claudeOnly || (!cursorOnly && dirExists(CLAUDE_DIR));
var installCursor = cursorOnly || (!claudeOnly && (dirExists(CURSOR_DIR) || dirExists(path.join(process.cwd(), '.cursor'))));

if (!installClaude && !installCursor) {
  console.error('  Error: No supported editor detected.');
  console.error('  Use --claude or --cursor to specify, or install an editor first.\n');
  process.exit(1);
}

var errors = [];

// ── Claude Code install ─────────────────────────────────────

if (installClaude) {
  if (!dirExists(CLAUDE_DIR)) {
    console.error('  Error: ~/.claude/ does not exist.');
    console.error('  Install Claude Code first: https://claude.ai/code\n');
    process.exit(1);
  }

  // Check if already installed
  var claudeInstalled = dirExists(path.join(SKILLS_DEST, 'designer-notes'));
  if (claudeInstalled && !force) {
    var versionFile = path.join(SKILLS_DEST, 'designer-notes', '.version');
    var installedVersion = fileExists(versionFile)
      ? fs.readFileSync(versionFile, 'utf8').trim()
      : 'unknown';

    if (installedVersion === VERSION) {
      console.log('  Claude Code: already installed (v' + VERSION + ').');
      if (!installCursor) {
        console.log('  Run with --force to reinstall.\n');
        process.exit(0);
      }
    } else {
      console.log('  Claude Code: updating v' + installedVersion + ' → v' + VERSION + '...\n');
      claudeInstalled = false; // proceed with install
    }
  }

  if (!claudeInstalled || force) {
    console.log('  Installing for Claude Code...');

    if (!dirExists(SKILLS_DEST)) {
      fs.mkdirSync(SKILLS_DEST, { recursive: true });
    }

    // Copy skill directories
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
    var claudeToolDest = path.join(SKILLS_DEST, 'designer-notes');
    TOOL_FILES.forEach(function (name) {
      var src = path.join(TOOLS_SOURCE, name);
      try {
        fs.copyFileSync(src, path.join(claudeToolDest, name));
        console.log('  \u2713 ' + name + ' copied');
      } catch (e) {
        errors.push(name + ': ' + e.message);
        console.log('  \u2717 ' + name + ' failed: ' + e.message);
      }
    });

    // Write version marker
    try {
      fs.writeFileSync(path.join(claudeToolDest, '.version'), VERSION + '\n');
    } catch (e) { /* non-critical */ }

    // Make hook.sh executable
    try {
      fs.chmodSync(path.join(claudeToolDest, 'hook.sh'), 0o755);
    } catch (e) { /* non-critical */ }
  }
}

// ── Cursor install ──────────────────────────────────────────

if (installCursor) {
  // Check if already installed
  var cursorInstalled = dirExists(CURSOR_DEST);
  if (cursorInstalled && !force) {
    var cursorVersionFile = path.join(CURSOR_DEST, '.version');
    var cursorInstalledVersion = fileExists(cursorVersionFile)
      ? fs.readFileSync(cursorVersionFile, 'utf8').trim()
      : 'unknown';

    if (cursorInstalledVersion === VERSION) {
      console.log('  Cursor: already installed (v' + VERSION + ').');
    } else {
      console.log('  Cursor: updating v' + cursorInstalledVersion + ' → v' + VERSION + '...\n');
      cursorInstalled = false;
    }
  }

  if (!cursorInstalled || force) {
    console.log('  Installing for Cursor...');

    // Copy tool files to ~/.cursor/designer-notes/
    if (!dirExists(CURSOR_DEST)) {
      fs.mkdirSync(CURSOR_DEST, { recursive: true });
    }

    CURSOR_TOOL_FILES.forEach(function (name) {
      var src = path.join(TOOLS_SOURCE, name);
      try {
        fs.copyFileSync(src, path.join(CURSOR_DEST, name));
        console.log('  \u2713 ' + name + ' copied to ~/.cursor/designer-notes/');
      } catch (e) {
        errors.push('cursor ' + name + ': ' + e.message);
        console.log('  \u2717 ' + name + ' failed: ' + e.message);
      }
    });

    // Write version marker
    try {
      fs.writeFileSync(path.join(CURSOR_DEST, '.version'), VERSION + '\n');
    } catch (e) { /* non-critical */ }

    // Copy commands to project .cursor/commands/ (if in a project)
    var projectCursorDir = path.join(process.cwd(), '.cursor', 'commands');
    if (!dirExists(projectCursorDir)) {
      fs.mkdirSync(projectCursorDir, { recursive: true });
      console.log('  Created ' + projectCursorDir);
    }

    try {
      copyDir(CURSOR_COMMANDS_SOURCE, projectCursorDir);
      console.log('  \u2713 Cursor commands installed to .cursor/commands/');
    } catch (e) {
      errors.push('cursor commands: ' + e.message);
      console.log('  \u2717 Cursor commands failed: ' + e.message);
    }
  }
}

// ── Report ──────────────────────────────────────────────────

if (errors.length > 0) {
  console.log('\n  Completed with ' + errors.length + ' error(s).\n');
  process.exit(1);
}

var steps = ['', '  Done! Next steps:', ''];
if (installClaude) {
  steps.push('  Claude Code:');
  steps.push('    1. Run /designer-notes <project-path> to set up');
  steps.push('    2. Press C to start commenting in the browser');
  steps.push('    3. Run /submit-feedback to apply your notes');
  steps.push('');
}
if (installCursor) {
  steps.push('  Cursor:');
  steps.push('    1. Run /designer-notes in Cursor\'s chat');
  steps.push('    2. Press C to start commenting in the browser');
  steps.push('    3. Run /submit-feedback to apply your notes');
  steps.push('');
}
console.log(steps.join('\n'));
