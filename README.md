# designer-notes

Pin comments to HTML elements, just like Figma. Then hand off to Claude Code or Cursor to apply the changes.

Learn more at [arturnbull.github.io/designer-notes-landing-page](https://arturnbull.github.io/designer-notes-landing-page/)

## Install

### Claude Code

```bash
npx designer-notes
```

This installs two Claude Code skills and the tool files to `~/.claude/skills/`.

### Cursor (experimental)

```bash
npx designer-notes --cursor
```

This installs tool files to `~/.cursor/designer-notes/` and slash commands to your project's `.cursor/commands/` directory. Cursor support is experimental — the core commenting workflow works, but Claude Code-specific features (model directives, skill invocations, parallel processing) are not available.

### Update

```bash
npx designer-notes@latest --force
```

## Quick start

1. Open Claude Code in any project with HTML files
2. Run `/designer-notes` — it adds the script and starts the dev server
3. Press **C** to enter comment mode, click elements to leave notes
4. Run `/submit-feedback` — Claude reads your notes and edits the code

## What it does

**designer-notes** is a browser-based commenting tool for reviewing AI-generated UI. It gives you a Figma-like workflow for leaving design feedback directly on rendered HTML pages.

Every comment is saved with its CSS selector and click position into a structured markdown file. When you run `/submit-feedback`, Claude reads that file and applies each change to the source code.

### Features

- **Pin notes to any element** — click a heading, button, or card to attach feedback
- **Batch reviews** — leave all your notes first, submit once
- **Slash commands** — use your environment's existing Claude skills
- **Model directives** — use `#opus`, `#sonnet`, or `#haiku` per comment
- **Effort directives** — use `#high-effort`, `#medium-effort`, or `#low-effort`
- **Auto-save** — comments persist and export to markdown automatically
- **Viewport tracking** — feedback includes window size so changes target the right breakpoint
- **Changelog** — cumulative HTML changelog generated after each feedback round

### Keyboard shortcuts

| Key | Action |
|-----|--------|
| `C` | Toggle comment mode |
| `⌘\` | Open / close sidepanel |
| `⌘.` | Show / hide all UI |

## Manual install

If you don't have npm, download the files directly:

```bash
mkdir -p ~/.claude/skills/designer-notes ~/.claude/skills/submit-feedback

# Tool files
curl -fsSL https://raw.githubusercontent.com/arturnbull/designer-notes/main/designer-notes.js \
  -o ~/.claude/skills/designer-notes/designer-notes.js
curl -fsSL https://raw.githubusercontent.com/arturnbull/designer-notes/main/serve.js \
  -o ~/.claude/skills/designer-notes/serve.js
curl -fsSL https://raw.githubusercontent.com/arturnbull/designer-notes/main/changelog-template.html \
  -o ~/.claude/skills/designer-notes/changelog-template.html

# Skill files
curl -fsSL https://raw.githubusercontent.com/arturnbull/designer-notes/main/skills/designer-notes/SKILL.md \
  -o ~/.claude/skills/designer-notes/SKILL.md
curl -fsSL https://raw.githubusercontent.com/arturnbull/designer-notes/main/skills/submit-feedback/SKILL.md \
  -o ~/.claude/skills/submit-feedback/SKILL.md
```

Then restart Claude Code.

## How it works

1. `/designer-notes` adds a `<script>` tag to your HTML and starts a local dev server
2. The server auto-finds an open port (defaults to 3847, increments if in use)
3. Press **C** in the browser to enter comment mode — click elements to place numbered pins
4. Type your feedback in the popover. Use `/skills` and `#directives` for advanced control
5. Comments auto-save to `feedback-YYYY-MM-DD.md` in your project directory
6. `/submit-feedback` parses the markdown, locates each element in source, and applies changes
7. After changes are applied, the browser clears automatically for the next review round

## Requirements

- [Claude Code](https://claude.ai/code) or [Cursor](https://cursor.com)
- Node.js 14+ (for the dev server)
- Any modern browser

## Uninstall

Claude Code:
```bash
rm -rf ~/.claude/skills/designer-notes ~/.claude/skills/submit-feedback
```

Cursor:
```bash
rm -rf ~/.cursor/designer-notes
rm .cursor/commands/designer-notes.md .cursor/commands/submit-feedback.md
```

## Links

- [Landing page](https://arturnbull.github.io/designer-notes-landing-page/)
- [GitHub](https://github.com/arturnbull/designer-notes)
- [npm](https://www.npmjs.com/package/designer-notes)

## License

MIT
