---
name: designer-notes
description: Wire designer-notes into the current project — adds the script tag, starts the dev server, and opens in browser for Figma-style feedback commenting
user-invocable: true
argument-hint: "<project-path> [filename.html]"
---

# Designer Notes

Set up the designer-notes feedback tool in the current project so the user can leave spatially-anchored comments on generated UI.

## What the hook handles automatically

A `PreToolUse` hook runs `setup.js` before this skill executes. It deterministically handles:
- **Tool file check** — verifies `designer-notes.js` and `serve.js` exist in `~/.claude/skills/designer-notes/`
- **Script injection** — finds HTML files and injects `<script src="...">` before `</body>` (skips if already present)
- **Server startup** — starts `serve.js` on port 3847 (auto-increments if in use), or detects an existing server
- **Changelog** — creates `.designer-notes/changelog.html` if it doesn't exist

The hook passes its results as a JSON `systemMessage`. Parse it to understand what happened.

## What this skill handles

### Step 1: Read the hook results

The hook output (in the system message) is JSON with this shape:
```json
{
  "projectDir": "/path/to/project",
  "toolFilesPresent": true,
  "htmlFiles": [
    { "file": "index.html", "status": "injected", "scriptSrc": "../../.claude/skills/..." },
    { "file": "about.html", "status": "already-present" }
  ],
  "server": { "status": "started", "port": 3847, "url": "http://localhost:3847" },
  "changelog": { "status": "already-exists" },
  "config": { "exists": true, "preferences": { "autoApply": false, "defaultModel": "sonnet" } },
  "update": { "installed": "1.6.0", "latest": "1.7.0", "command": "npx designer-notes@latest --force" }
}
```

If no project path was provided (hook message says "no project path provided"), ask the user which project directory to set up. Then run setup.js manually:
```bash
node ~/.claude/skills/designer-notes/setup.js --platform claude <project-dir> [filename.html]
```

If `toolFilesPresent` is false, tell the user to install: `npx designer-notes@latest`

If any HTML file has `status: "no-body-tag"`, warn the user.

If `update` is present, tell the user at the end of your report: **designer-notes v{latest} is available** (you have v{installed}). Run `{command}` to update. This is informational — don't block setup.

### Step 2: First-run config (only if `config.exists` is false)

If no `dn-config.json` exists yet, ask the user two questions:

1. **Auto-apply edits?** — Should `/submit-feedback` apply changes without asking for confirmation? (Default: no)
2. **Default model?** — Which model should process feedback comments by default? (opus / sonnet / haiku, default: sonnet)

Then generate `dn-config.json` in the project directory:
- Scan `~/.claude/skills/` for directories containing `SKILL.md`
- Scan the project's `.claude/skills/` if it exists
- For each skill, read the frontmatter to extract `name` and `description`
- Only include skills where `user-invocable` is `true` (or not set, since default is true)
- Write the config:
  ```json
  {
    "skills": [
      { "name": "arrange", "description": "Improve layout and spacing" }
    ],
    "directives": [
      { "name": "opus", "description": "Use Opus model (most capable)", "group": "model" },
      { "name": "sonnet", "description": "Use Sonnet model (fast + capable)", "group": "model" },
      { "name": "haiku", "description": "Use Haiku model (fastest)", "group": "model" },
      { "name": "high-effort", "description": "Maximum reasoning depth", "group": "effort" },
      { "name": "medium-effort", "description": "Balanced reasoning", "group": "effort" },
      { "name": "low-effort", "description": "Quick pass", "group": "effort" }
    ],
    "preferences": {
      "defaultModel": "<user's choice>",
      "availableModels": ["opus", "sonnet", "haiku"],
      "defaultEffort": "medium-effort",
      "autoApply": <user's choice>,
      "showUI": true,
      "hideToggleButton": false
    }
  }
  ```

If config already exists, skip this step entirely.

### Step 2b: First-run onboarding (only if config was just created in Step 2)

If you just created the config (first run for this project), display this onboarding message exactly (replacing `{url}` with the actual server URL + filename):

> **designer-notes is ready.** Here's how it works:
>
> 1. **Open {url}** in your browser
> 2. **Press C** to comment — click any element to pin your feedback
> 3. **Come back here** and run `/submit-feedback` when you're ready to apply changes
>
> Comments save automatically as you go. Nothing to export.

This is the only time this message should appear — on subsequent runs, skip it.

### Step 3: Open in browser

Open at the server URL from the hook results (e.g., `http://localhost:3847/index.html`). Use the first HTML file from the hook results, or the argument if provided.

### Step 4: Report

Tell the user:
- Which files have the script tag (from hook results)
- Server URL and port
- Where feedback files will save
- Remind: press `C` to enter comment mode, click to place pins, Enter to submit, click the blue circle to open the panel

## How the feedback workflow works

1. `/designer-notes` — sets up the project (this skill)
2. User comments on the pages in the browser
3. Comments persist across pages via localStorage (shared on localhost origin)
4. Comments auto-save to `feedback-[date].md` in the project folder
5. User runs `/submit-feedback` — Claude reads the file and makes targeted revisions

## Notes
- The script is self-contained (zero dependencies, injects its own CSS)
- Comments persist across page navigation via localStorage
- The panel shows ALL comments grouped by page, not just the current page
- The server must be running for feedback files to save to disk
- If no server is detected, commenting still works but auto-export is disabled
