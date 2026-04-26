# designer-notes

## What This Is

Figma-style feedback commenting tool for AI-generated UI. Single self-contained JS file (`designer-notes.js`, ~3800 lines IIFE) with zero dependencies. Users pin comments, edit text, and inspect/edit CSS on HTML pages, then hand off feedback to Claude Code, Cursor, or Codex.

## Role

This is the canonical npm package source. The landing page (`../designer-notes/`) has a copy of `designer-notes.js` for testing — copy the file over after changes. Don't publish to npm during local dev; don't bump `package.json` version until publishing.

## Three Modes

- **Comment mode** (C key) — pin numbered comments to elements
- **Text edit mode** (T key) — click text elements to edit inline
- **Inspect mode** (I key) — select elements, view/edit CSS in a Figma-style side panel

Modes are mutually exclusive. Each has a toggle button in the bottom-right toolbar.

## Inspector Panel (v2 — in progress)

Docked right side panel (260px) with 8 Figma-ordered sections:
1. **Position** — X/Y (editable as intent, AI decides CSS approach)
2. **Size** — W/H, rotation (read-only), corner radius
3. **Padding** — spatial 4-input layout (blue center box)
4. **Margin** — spatial 4-input layout (amber center box)
5. **Layout** — conditional on flex/grid: gap, direction, justify, align
6. **Appearance** — fill swatch, stroke swatch+width, opacity %
7. **Typography** — conditional on text: font, size, weight, leading, tracking, color
8. **Effects** — conditional: box-shadow

Labels sit above fields (Figma convention), except Position/Size which use inline X/Y/W/H labels. Sections auto-collapse when all values are defaults.

## Key Architecture Decisions

- All code in one IIFE file — no modules, no build step, no external deps
- CSS injected via JS (STYLES array of single-line strings)
- State persisted to localStorage under key `dn-comments`
- Feedback synced to markdown via local server (`serve.js`) at `/save-feedback`
- CSS edits use inline style overrides (`element.style.setProperty`)
- Position edits recorded as intent `{before: {x,y}, after: {x,y}}`, previewed with `transform: translate()`

## Gotchas

- `data-designer-notes` attribute on all tool UI elements — used to exclude from hover/click targeting. Miss this and clicks pass through to the tool UI instead of the page.
- The `.dn-inspect-panel` slide-in animation should only fire on first open, not when switching elements — `isFirstOpen` flag controls this.
- `computeSelector()` can return stale selectors if the DOM changes. Edits mark stale when selectors don't match on reapply.
- `inspectOriginalValues` cache must be cleared when `clearAllComments()` runs, otherwise undo/revert uses stale originals.
- Undo must call `clearAllInspectInlineStyles()` before `reapplyCssEdits()` — otherwise orphaned inline styles persist.

## Testing Locally

```bash
# From the landing page directory (../designer-notes/)
node ../designer-notes-pkg/serve.js . 3847
# Open http://localhost:3847
# Press I to enter inspect mode
```

## Specs & Plans

- `docs/superpowers/specs/2026-04-25-inspector-mode-design.md` — v1 spec (tooltip, superseded)
- `docs/superpowers/specs/2026-04-25-inspector-panel-v2-design.md` — v2 spec (side panel, current)
- `docs/superpowers/plans/2026-04-25-inspector-mode.md` — v1 implementation plan
- `docs/superpowers/plans/2026-04-25-inspector-panel-v2.md` — v2 implementation plan
