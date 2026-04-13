---
name: submit-feedback
description: Read a UI feedback markdown file exported by designer-notes and apply targeted code revisions
user-invocable: true
argument-hint: "[path/to/feedback.md]"
---

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
   - Flag it in the summary table with "⚠️ REPEAT"
   - Note what was tried last time (quote the archived comment text)
   - Take a different approach this time — the previous fix didn't work

8. **Apply changes** for each selected comment:
   - **Parallelism:** When multiple comments target different files, or when spawning subagents (model directives, skill invocations), launch them in parallel using multiple Agent tool calls in a single message. Only serialize comments that edit the same file without subagents. This dramatically speeds up large feedback rounds.
   - Make the targeted edit (HTML, CSS, or both)
   - If a comment is ambiguous or needs a design call, use your best judgment — the user shouldn't have to think about whether they clicked a container or a leaf element. Infer intent from the comment text, the element context, and the click location.
   - If truly unclear, ask — but default to acting.
   - **Skill invocations:** If the comment text contains a `/skill-name` reference (preceded by whitespace or at start of text, matching a known skill), invoke that skill on the targeted element's source file after applying any text-based changes from the same comment. The skill invocation is automatic — the user gave permission by including it. Strip the `/skill-name` from the comment text before treating the rest as literal feedback. Known skills can be found in `dn-config.json` in the project directory.
   - **Directives:** Comments may contain `#directive` references (preceded by whitespace or at start of text) that control execution. Parse these and apply them per-comment:
     - **Model directives** (`#opus`, `#sonnet`, `#haiku`): Spawn a subagent with the specified model to handle this comment's entire processing — both the literal feedback changes AND any skill invocations. Use the Agent tool with `model: "sonnet"` (or opus/haiku). The subagent prompt must include all context: the file path, the CSS selector, the comment text (with directives stripped), and what skills to invoke. This is mandatory — do NOT process the comment yourself if a model directive is present.
     - **Default model**: If no `#model` directive is present on a comment, check `dn-config.json` for `preferences.defaultModel`. If set, use that model (spawn a subagent). If not set, process the comment with your current model. **This is mandatory — you MUST spawn a subagent with the configured default model. Do NOT process comments directly if a defaultModel is configured, even if your current model matches. The user chose this setting for cost and speed control.**
     - **Effort directives** (`#high-effort`, `#medium-effort`, `#low-effort`): Set the reasoning effort level for this comment's processing. If no effort directive is present, check `preferences.defaultEffort` in the config.
     - Strip all directives from the comment text before treating the rest as literal feedback.
     - If conflicting directives appear (e.g., `#opus #sonnet`), use the last one.
     - Available directives and defaults are in `dn-config.json`.

9. **After all changes, present an action log.** This is mandatory. Format:

   ### Action Log
   | # | Comment | Model | What Changed | File:Line |
   |---|---------|-------|-------------|-----------|
   | 1 | "add a line break" | opus | Added `<br>` before `<em>` in hero heading | test.html:482 |
   | 2 | "fix padding /arrange #sonnet" | sonnet | Ran /arrange on nav section; restructured padding | test.html:100 |

   For each row: the original comment text (including any skill invocations and directives), which model processed it (default to current model if no `#model` directive), a plain-language description of the change, and the file + approximate line number.

10. **Write changelog HTML.** Before archiving, update the cumulative `.designer-notes/changelog.html` file. Create the `.designer-notes/` directory if it doesn't exist. This is an append-to-top file — each round adds a new section.
    - If the file exists, read it and extract the existing `<section>` elements from inside `<main>`
    - Create a new `<section>` for this round with an `<h2>` heading (timestamp) and a simple table (columns: #, Comment, What Changed, File)
    - Prepend the new section before existing sections
    - Write the complete HTML file with all sections
    - Include a simple filter bar at the top that lets users filter by date (text search across headings)
    - **Design:** Clean, minimal, light background. System font stack. No dark theme, no heavy styling. Think plain HTML with just enough CSS to be readable — like a GitHub markdown render. The point is utility, not aesthetics.

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
- Empty comments (no text, just a flagged element) mean "look at this element, something is off"
