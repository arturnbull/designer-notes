# designer-notes

Set up the designer-notes feedback tool so the user can leave spatially-anchored comments on UI in the browser.

## Step 1: Run setup

Run the setup script in the terminal. Use the workspace root as the project directory:

```bash
node ~/.cursor/designer-notes/setup.js --platform cursor "<project-directory>"
```

If the user specified a particular HTML file, pass it as a second argument.

The script outputs JSON. Parse it — here's the shape:

```json
{
  "projectDir": "/path/to/project",
  "toolFilesPresent": true,
  "htmlFiles": [
    { "file": "index.html", "status": "injected" },
    { "file": "about.html", "status": "already-present" }
  ],
  "server": { "status": "started", "port": 3847, "url": "http://localhost:3847" },
  "changelog": { "status": "already-exists" },
  "config": { "exists": true, "preferences": { "autoApply": false } }
}
```

If `toolFilesPresent` is false, tell the user to run: `npx designer-notes --cursor`

## Step 2: First-run config (only if `config.exists` is false)

If no `dn-config.json` exists, ask the user:

1. **Auto-apply edits?** — Should `/submit-feedback` apply changes without confirmation? (Default: no)

Then create `dn-config.json` in the project directory:

```json
{
  "editor": "cursor",
  "skills": [],
  "directives": [],
  "preferences": {
    "autoApply": false,
    "showUI": true,
    "hideToggleButton": false
  }
}
```

If config already exists, skip this step.

## Step 3: First-run onboarding (only if config was just created)

Display this message (replace `{url}` with the actual server URL + filename):

> **designer-notes is ready.** Here's how it works:
>
> 1. **Open {url}** in your browser
> 2. **Press C** to comment — click any element to pin your feedback
> 3. **Come back here** and run `/submit-feedback` when you're ready to apply changes
>
> Comments save automatically as you go. Nothing to export.

## Step 4: Open in browser

Open the server URL from the setup results (e.g., `http://localhost:3847/index.html`).

## Step 5: Report

Tell the user:
- Which files have the script tag
- Server URL and port
- Where feedback files will save
- Press C to comment, click to pin, Enter to submit, blue circle button opens the panel
