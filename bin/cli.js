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
    '    npx designer-notes              Auto-detect editor and install',
    '    npx designer-notes --claude      Install for Claude Code only',
    '    npx designer-notes --cursor      Install for Cursor only',
    '    npx designer-notes --force       Overwrite existing install',
    '    npx designer-notes --uninstall   Remove files and hook',
    '    npx designer-notes --version     Show version',
    '    npx designer-notes --help        Show this help',
    '',
    '  Claude Code: files installed to ~/.claude/skills/',
    '  Cursor: tool files to ~/.cursor/designer-notes/,',
    '          commands to <project>/.cursor/commands/',
    ''
  ].join('\n'));
  process.exit(0);
}

// ── Uninstall ────────────────────────────────────────────────

if (args.includes('--uninstall')) {
  console.log('\n  designer-notes v' + VERSION + ' — uninstalling\n');
  var uninstallErrors = [];

  // Remove Claude Code skills and tools
  var claudeSkillDir = path.join(os.homedir(), '.claude', 'skills', 'designer-notes');
  var claudeSubmitDir = path.join(os.homedir(), '.claude', 'skills', 'submit-feedback');
  [claudeSkillDir, claudeSubmitDir].forEach(function (dir) {
    if (fs.existsSync(dir)) {
      try {
        fs.rmSync(dir, { recursive: true });
        console.log('  \u2713 Removed ' + dir);
      } catch (e) {
        uninstallErrors.push(e.message);
        console.log('  \u2717 Failed to remove ' + dir + ': ' + e.message);
      }
    }
  });

  // Remove hook from settings.json
  var settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  var hookCommand = 'bash ~/.claude/skills/designer-notes/hook.sh';
  try {
    if (fs.existsSync(settingsPath)) {
      var settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      if (settings.hooks && Array.isArray(settings.hooks.PreToolUse)) {
        var before = settings.hooks.PreToolUse.length;
        settings.hooks.PreToolUse = settings.hooks.PreToolUse.filter(function (entry) {
          if (entry.matcher !== 'Skill' || !Array.isArray(entry.hooks)) return true;
          return !entry.hooks.some(function (h) { return h.command === hookCommand; });
        });
        if (settings.hooks.PreToolUse.length < before) {
          // Clean up empty hook arrays
          if (settings.hooks.PreToolUse.length === 0) delete settings.hooks.PreToolUse;
          if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
          fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
          console.log('  \u2713 Removed hook from settings.json');
        } else {
          console.log('  \u2713 No hook found in settings.json (already clean)');
        }
      }
    }
  } catch (e) {
    uninstallErrors.push(e.message);
    console.log('  \u2717 Failed to update settings.json: ' + e.message);
  }

  // Remove Cursor files
  var cursorDest = path.join(os.homedir(), '.cursor', 'designer-notes');
  if (fs.existsSync(cursorDest)) {
    try {
      fs.rmSync(cursorDest, { recursive: true });
      console.log('  \u2713 Removed ' + cursorDest);
    } catch (e) {
      uninstallErrors.push(e.message);
      console.log('  \u2717 Failed to remove ' + cursorDest + ': ' + e.message);
    }
  }

  if (uninstallErrors.length > 0) {
    console.log('\n  Uninstall completed with ' + uninstallErrors.length + ' error(s).\n');
    process.exit(1);
  }
  console.log('\n  Uninstalled successfully.\n');
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
  var skipFileCopy = false;
  if (claudeInstalled && !force) {
    var versionFile = path.join(SKILLS_DEST, 'designer-notes', '.version');
    var installedVersion = fileExists(versionFile)
      ? fs.readFileSync(versionFile, 'utf8').trim()
      : 'unknown';

    if (installedVersion === VERSION) {
      console.log('  Claude Code: files already installed (v' + VERSION + ').');
      skipFileCopy = true;
    } else {
      console.log('  Claude Code: updating v' + installedVersion + ' → v' + VERSION + '...\n');
    }
  }

  if (!skipFileCopy) {
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

  // Wire PreToolUse hook into settings.json (always runs, even if files were already installed)
  var settingsPath = path.join(CLAUDE_DIR, 'settings.json');
  var hookCommand = 'bash ~/.claude/skills/designer-notes/hook.sh';
  try {
    var settings = {};
    if (fileExists(settingsPath)) {
      var raw = fs.readFileSync(settingsPath, 'utf8');
      try {
        settings = JSON.parse(raw);
      } catch (parseErr) {
        console.log('  \u2717 ~/.claude/settings.json has a syntax error — cannot register hook.');
        console.log('    Fix the JSON manually, then re-run: npx designer-notes --force');
        errors.push('settings.json: invalid JSON — ' + parseErr.message);
        settings = null;
      }
    }
    if (settings !== null) {
      if (!settings.hooks) settings.hooks = {};
      if (!Array.isArray(settings.hooks.PreToolUse)) settings.hooks.PreToolUse = [];

      // Check if our hook is already registered
      var alreadyRegistered = settings.hooks.PreToolUse.some(function (entry) {
        return entry.matcher === 'Skill' && Array.isArray(entry.hooks) &&
          entry.hooks.some(function (h) { return h.command === hookCommand; });
      });

      if (!alreadyRegistered) {
        settings.hooks.PreToolUse.push({
          matcher: 'Skill',
          hooks: [
            {
              type: 'command',
              command: hookCommand,
              timeout: 30,
              statusMessage: 'Setting up designer-notes...'
            }
          ]
        });
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
        console.log('  \u2713 PreToolUse hook registered in settings.json');
      } else {
        console.log('  \u2713 PreToolUse hook already registered');
      }
    }
  } catch (e) {
    errors.push('settings.json hook: ' + e.message);
    console.log('  \u2717 Failed to register hook in settings.json: ' + e.message);
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
