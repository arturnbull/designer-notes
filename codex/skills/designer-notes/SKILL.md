---
name: designer-notes
description: Wire designer-notes into the current project — adds the script tag, starts the dev server, and opens in browser for Figma-style feedback commenting
---

# Designer Notes

Set up the designer-notes feedback tool in the current project so the user can leave spatially-anchored comments on generated UI.

## Step 1: Run setup

Run the setup script. Use the current working directory (or the path the user provided) as the project directory:

```bash
node ~/.agents/skills/designer-notes/setup.js --platform codex "<project-directory>" [filename.html]
```

Parse the JSON output. Here's the shape:

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
  "config": { "exists": true, "preferences": { "autoApply": false, "defaultModel": "gpt-4o" } }
}
```

If `toolFilesPresent` is false, tell the user to install: `npx designer-notes@latest --codex`

If any HTML file has `status: "no-body-tag"`, warn the user.

## Step 2: First-run config (only if `config.exists` is false)

If no `dn-config.json` exists yet, ask the user two questions:

1. **Auto-apply edits?** — Should `$submit-feedback` apply changes without asking for confirmation? (Default: no)
2. **Default model?** — Which model should process feedback comments by default? (o3 / gpt-4o / o4-mini, default: gpt-4o)

Then generate `dn-config.json` in the project directory:

```json
{
  "editor": "codex",
  "skills": [],
  "directives": [
    { "name": "o3", "description": "Use o3 model (most capable)", "group": "model" },
    { "name": "gpt-4o", "description": "Use GPT-4o model (fast + capable)", "group": "model" },
    { "name": "o4-mini", "description": "Use o4-mini model (fastest)", "group": "model" },
    { "name": "high-effort", "description": "Maximum reasoning depth", "group": "effort" },
    { "name": "medium-effort", "description": "Balanced reasoning", "group": "effort" },
    { "name": "low-effort", "description": "Quick pass", "group": "effort" }
  ],
  "preferences": {
    "defaultModel": "<user's choice>",
    "availableModels": ["o3", "gpt-4o", "o4-mini"],
    "defaultEffort": "medium-effort",
    "autoApply": false,
    "showUI": true,
    "hideToggleButton": false
  }
}
```

Note: The `skills` array is empty for Codex — Codex skills use `$` prefix invocation and don't need to be listed in config for autocomplete. If Codex gains a skill discovery API in the future, this can be populated.

If config already exists, skip this step.

## Step 2b: First-run onboarding (only if config was just created)

Display this message (replace `{url}` with the actual server URL + filename):

> **designer-notes is ready.** Here's how it works:
>
> 1. **Open {url}** in your browser
> 2. **Press C** to comment — click any element to pin your feedback
> 3. **Come back here** and run `$submit-feedback` when you're ready to apply changes
>
> Comments save automatically as you go. Nothing to export.

## Step 3: Open in browser

Open at the server URL from the setup results.

## Step 4: Report

Tell the user:
- Which files have the script tag
- Server URL and port
- Where feedback files will save
- Press C to comment, click to pin, Enter to submit, blue circle button opens the panel
