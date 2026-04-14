# Submit Feedback

Read structured UI feedback exported by designer-notes.js and make targeted revisions to the source code.

## Steps

1. **Locate the feedback file.** If a path argument is provided, use it. Otherwise:
   - Search the current working directory for `feedback-*.md` files
   - Search `~/Downloads/` for `feedback-*.md` files, sorted by most recent
   - If multiple found, list them and ask which to use

2. **Read and parse the feedback file.** The file is grouped by page. Extract from each `### Comment N` block:
   - CSS selector (from the `**Element:**` line — content inside backticks)
   - Tag name and text preview (from the `**Tag:**` line)
   - Position data (from the `**Position:**` line)
   - Comment text (the blockquoted `>` lines)
   - Which page it belongs to (from the `## Page:` header)

3. **Identify the source files.** Map each `## Page:` section to the actual HTML file in the project. The page value is the URL path (e.g., `test.html`, `test-pricing.html`). Find these files in the project directory.

4. **For each comment, locate the code:**
   - Use the CSS selector to understand which HTML element is targeted
   - Search the source file for that element using the tag name and text preview as confirmation
   - If the selector targets a styled element, also check CSS rules that apply to it

5. **Present a summary table:**

   | # | Page | Element | Feedback | Proposed Action |
   |---|------|---------|----------|-----------------|
   | 1 | test.html | `h1` "Welcome..." | Too generic | Revise heading text |
   | 2 | test-pricing.html | `.price` "$49/mo" | Not prominent | Increase font-size |

6. **Ask how to proceed.** First check `dn-config.json` for `preferences.autoApply`. If `true`, skip this step and apply all comments automatically. Otherwise ask:
   - "Apply all" — work through each comment sequentially
   - "Let me pick" — the user selects which comments to address
   - "Just the plan" — show analysis only, no edits

7. **Check for repeat comments.** Before applying changes, read `feedback-archive.md` (if it exists) and check whether any current comments target the same CSS selector as a previously archived comment. If a match is found:
   - Flag it in the summary table with "REPEAT"
   - Note what was tried last time (quote the archived comment text)
   - Take a different approach this time — the previous fix didn't work

8. **Apply changes** for each comment:
   - Make the targeted edit (HTML, CSS, or both)
   - If a comment is ambiguous or needs a design call, use your best judgment — the user shouldn't have to think about whether they clicked a container or a leaf element. Infer intent from the comment text, the element context, and the click location.
   - If truly unclear, ask — but default to acting.
   - **Inline hints:** Comments may contain `/keyword` references. These are design intent hints — interpret them as follows and apply accordingly:
     - `/arrange` — improve layout, spacing, and visual rhythm
     - `/animate` — add purposeful animations or micro-interactions
     - `/bolder` — make the design more visually impactful
     - `/clarify` — improve UX copy, labels, or instructions
     - `/colorize` — add strategic color to the design
     - `/delight` — add moments of personality or polish
     - `/distill` — simplify, remove unnecessary complexity
     - `/harden` — improve error handling and edge cases
     - `/optimize` — fix performance issues
     - `/overdrive` — push the design with ambitious effects
     - `/polish` — fix alignment, spacing, consistency, micro-details
     - `/quieter` — tone down overstimulating elements
     - `/typeset` — improve typography and text hierarchy
     Strip the `/keyword` from the comment text before treating the rest as literal feedback.
   - **Directives to ignore:** Comments may contain `#opus`, `#sonnet`, `#haiku`, `#high-effort`, `#medium-effort`, `#low-effort`. These are Claude Code-specific directives. Strip them from the comment text and ignore them.

9. **After all changes, present an action log.** This is mandatory. Format:

   ### Action Log
   | # | Comment | What Changed | File:Line |
   |---|---------|-------------|-----------|
   | 1 | "add a line break" | Added `<br>` before `<em>` in hero heading | test.html:482 |
   | 2 | "fix padding /arrange" | Improved spacing in nav section | test.html:100 |

   For each row: the original comment text, a plain-language description of the change, and the file + approximate line number.

10. **Write changelog HTML.** Before archiving, update the cumulative `.designer-notes/changelog.html` file. Create the `.designer-notes/` directory if it doesn't exist. This is an append-to-top file — each round adds a new section.
    - **Template:** Read `~/.cursor/designer-notes/changelog-template.html` for the HTML shell (styles, layout, filter bar). If the template exists, use it as the wrapper — replace the `<!-- SECTIONS -->` comment with the section elements. If the template doesn't exist, create a minimal HTML page with system font stack, light background, centered 720px max-width layout, and a filter input.
    - If the changelog file already exists, read it and extract the existing `<section>` elements from inside `<main>`
    - Create a new `<section>` for this round with an `<h2>` heading (timestamp) and a simple table (columns: #, Comment, What Changed, File). Each table row cell for File should have `class="file"`.
    - Prepend the new section before existing sections
    - Write the complete HTML file with all sections

11. **Archive feedback.** After all changes are applied:
    - Send a POST request to the dev server to archive the feedback file:
      ```bash
      curl -s -X POST http://localhost:3847/archive-feedback
      ```
    - This moves the feedback file to `feedback-archive.md` (appending if it already exists) and signals the browser client to automatically clear all pins, comments, undo history, dismiss the panel, and scroll to top.
    - If the server is not running, skip this step (the feedback file stays in place).

12. **After the action log**, let the user know changes are live and the browser will reset automatically.

## Feedback File Format

The file follows this structure (generated by designer-notes.js):

```markdown
# UI Feedback
Generated: [timestamp]
Total comments: [N]
Viewport: [width]x[height]

---

## Page: [page-path]

### Comment 1
**Element:** `[CSS selector]`
**Tag:** [TAG] | **Text:** "[preview]"
**Position:** click at (x, y) on page; offset (x, y) within element
**Element bounds:** WxH at (x, y)

> [The actual feedback text]

---

## Page: [another-page-path]

### Comment 2
...
```

## Notes
- Comments are grouped by page — each page section maps to a specific HTML file
- The CSS selector is the primary locator for finding the element in source code
- Tag name and text preview serve as confirmation
- Position data provides additional context when selectors are ambiguous
- **Viewport size** indicates which breakpoint the user was viewing when they left feedback. Use this to determine whether changes should target a responsive breakpoint (e.g., a comment left at 375px wide is about the mobile layout — apply fixes inside the appropriate `@media` query, not the base styles)
- Empty comments (no text, just a flagged element) mean "look at this element, something is off"
