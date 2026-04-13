---
name: designer-notes
description: Wire designer-notes into the current project — adds the script tag, starts the dev server, and opens in browser for Figma-style feedback commenting
user-invocable: true
argument-hint: "[filename.html]"
---

# Designer Notes

Set up the designer-notes feedback tool in the current project so the user can leave spatially-anchored comments on generated UI.

## Step 0: Locate tool files

The tool files (`designer-notes.js` and `serve.js`) should be in `~/.claude/skills/designer-notes/`. Check if they exist:

```bash
ls ~/.claude/skills/designer-notes/designer-notes.js ~/.claude/skills/designer-notes/serve.js
```

**If both files exist**, continue to Step 1.

**If files are missing**, try to install them automatically:

1. First, try npx:
   ```bash
   npx designer-notes@latest
   ```
2. If npx fails (no Node.js, no npm), try downloading from GitHub:
   ```bash
   mkdir -p ~/.claude/skills/designer-notes ~/.claude/skills/submit-feedback
   curl -fsSL https://raw.githubusercontent.com/arturnbull/designer-notes/main/designer-notes.js -o ~/.claude/skills/designer-notes/designer-notes.js
   curl -fsSL https://raw.githubusercontent.com/arturnbull/designer-notes/main/serve.js -o ~/.claude/skills/designer-notes/serve.js
   curl -fsSL https://raw.githubusercontent.com/arturnbull/designer-notes/main/skills/designer-notes/SKILL.md -o ~/.claude/skills/designer-notes/SKILL.md
   curl -fsSL https://raw.githubusercontent.com/arturnbull/designer-notes/main/skills/submit-feedback/SKILL.md -o ~/.claude/skills/submit-feedback/SKILL.md
   ```
3. If both methods fail, tell the user: "designer-notes tool files are missing. Install with `npx designer-notes` or download from https://github.com/arturnbull/designer-notes"

**Do not proceed until both files are confirmed present.**

## Step 1: Find target HTML files

If an argument is provided, use that filename. Otherwise, search the current working directory for `*.html` files (non-recursive first, then recursive if none found).

If multiple HTML files found, list them and ask which one(s) to set up. Accept "all" to add to every file.

## Step 2: Add the script tag

For each target file:
- Check if `designer-notes.js` is already referenced. If yes, skip and report "already set up."
- Create a symlink to `designer-notes.js` in the project root (if one doesn't already exist):
  ```bash
  ln -sf ~/.claude/skills/designer-notes/designer-notes.js [project-directory]/designer-notes.js
  ```
  If the symlink fails (e.g., Windows or unsupported filesystem), copy the file instead:
  ```bash
  cp ~/.claude/skills/designer-notes/designer-notes.js [project-directory]/designer-notes.js
  ```
- Insert `<script src="designer-notes.js"></script>` just before the closing `</body>` tag. If the file has no `</body>` tag, insert before `</html>` or append to the end of the file.
- If the project has a `.gitignore`, add `designer-notes.js` to it (so the symlink/copy isn't committed).
- Report what was added.

## Step 3: Generate dn-config.json

Scan for available skills and write a config file to the project directory:
- Scan `~/.claude/skills/` for directories containing `SKILL.md`
- Scan the project's `.claude/skills/` if it exists
- For each skill, read the frontmatter to extract `name` and `description`
- Only include skills where `user-invocable` is `true` (or not set, since default is true)
- Write `dn-config.json` to the project directory with this structure:
  ```json
  {
    "skills": [
      { "name": "arrange", "description": "Improve layout and spacing" },
      { "name": "animate", "description": "Add purposeful animations" }
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
      "defaultModel": "sonnet",
      "availableModels": ["opus", "sonnet", "haiku"],
      "defaultEffort": "medium-effort",
      "autoApply": false,
      "showUI": true,
      "hideToggleButton": false
    }
  }
  ```
- If `dn-config.json` already exists, merge — update the skills list but preserve any existing preferences.

## Step 4: Start the dev server

Run the dev server in the background:
```bash
node ~/.claude/skills/designer-notes/serve.js [project-directory] &
```

The server runs on `http://localhost:3847` and:
- Serves the project's HTML files
- Accepts POST `/save-feedback` to write feedback markdown to the project folder
- Serves GET `/config` with the skills list from `dn-config.json`
- The script auto-detects the server and uses it for saving

## Step 5: Open in browser

Open at `http://localhost:3847/[filename.html]` (NOT as a file:// URL — the server is required for saving feedback).

## Step 6: Report the setup

- Which files were wired up
- Server URL
- Where feedback files will be saved
- Remind: press `C` to enter comment mode, click to place pins, Enter to submit a comment, click the blue circle button to open the panel

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
