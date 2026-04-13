# Privacy Policy — designer-notes

**Last updated:** April 13, 2026

## Overview

designer-notes is a browser-based commenting tool that runs entirely on your local machine. It does not collect, transmit, or store any personal data on external servers.

## What data is created

When you use designer-notes, the following data is created and stored **locally on your machine only**:

- **Comments and feedback** — stored in your browser's localStorage and exported as markdown files to your project directory
- **Position data** — CSS selectors and click coordinates for pinned comments, stored alongside your feedback
- **Configuration** — your preferences (default model, effort level, auto-apply setting) stored in `dn-config.json` in your project directory

## What data is NOT collected

- No data is sent to any external server, API, or third party
- No analytics, telemetry, or usage tracking is built into the tool
- No account or authentication is required
- No cookies are set (localStorage is used for comment persistence only)

## Local dev server

The dev server (`serve.js`) runs on `localhost` and is only accessible from your own machine. It handles saving feedback files to disk and serving your project's HTML files. It does not expose any network-accessible endpoints.

## npm installation

Running `npx designer-notes` downloads the package from the npm registry. npm's standard telemetry and download tracking may apply per [npm's privacy policy](https://docs.npmjs.com/policies/privacy).

## Landing page

The designer-notes landing page (arturnbull.github.io/designer-notes-landing-page) uses Google Analytics and Hotjar for visitor analytics. This is separate from the tool itself and only applies to visitors of the landing page, not users of the plugin.

## Third-party services

When you use designer-notes with Claude Code, your feedback content is processed by Claude (Anthropic's AI) as part of the `/submit-feedback` workflow. This is governed by [Anthropic's privacy policy](https://www.anthropic.com/privacy) and your existing Claude Code usage terms.

## Changes to this policy

Any changes will be reflected in this file with an updated date. Since the tool runs locally and collects no data, material changes are unlikely.

## Contact

Questions or concerns: [andrew-turnbull.com/contact](https://www.andrew-turnbull.com/contact/)
