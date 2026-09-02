# AGENTS.md - ZenMux Chat Engineering & Workflow Guidelines

This document outlines the mandatory engineering standards, development lifecycle, testing protocols, and versioning rules for ZenMux Chat. All AI agents operating in this repository must strictly adhere to these practices without exception.

---

## 1. Core Engineering Dogmas & Research Protocol

### 1.1 Empirical Verification & Best Practice First
- Always recall and apply industry-standard best practices (e.g. Effective Go/Node.js, W3C standards, OpenAPI specifications, and clean architectural separation).
- **Never Hallucinate or Guess**: Do not guess API endpoints, query parameters, authentication headers, rate limits, or library behaviors.
- **Mandatory Online Verification**: If you are uncertain about any third-party service, API specification, or modern web standard, you **MUST actively search and check official online documentation first** before writing any code.

### 1.2 Preservation of Integrity & Occam's Razor
- Code must be terse, crystalline, and modular. Eliminate superfluous complexity without compromising semantic clarity or robustness.
- Do not delete or refactor existing code without empirical verification of systemic impact.

---

## 2. Semantic Versioning & Git Commit Protocol

Every feature, refactor, bugfix, or documentation update must be accompanied by an atomic semantic version bump and a strictly formatted Git commit.

### 2.1 Version Tri-Synchronization
When bumping a version (e.g., from `2.6.1` to `2.6.2`), synchronize all three files simultaneously:
1. `package.json`: `"version": "X.Y.Z"`
2. `js/state.js`: `export const APP_VERSION = 'X.Y.Z';`
3. `index.html`: `<span class="app-version-badge">vX.Y.Z</span>`

### 2.2 Version Badge UI Styling Rule
- The version badge in the sidebar header must remain minimalist and clean: compact font size, subtle text color, and **no background pill color**.

### 2.3 Commit Message Format
Every commit message must follow Conventional Commits and explicitly contain the semantic version tag:
- `feat(vX.Y.Z): add <feature description>`
- `fix(vX.Y.Z): resolve <bug description>`
- `refactor(vX.Y.Z): <refactoring scope>`
- `chore(vX.Y.Z): <maintenance scope>`
- `docs(vX.Y.Z): <documentation update>`

---

## 3. Test-Driven Development (TDD) & Pre-Commit Verification

### 3.1 Scratch Test Directory
- Store all temporary test scripts, API simulation runners, and scratch validation code strictly under `scratch/` (e.g. `scratch/test_<feature>.js`).
- `scratch/` is ignored in `.gitignore` and must never be committed to Git.

### 3.2 Pre-Implementation Simulation
- Before modifying production files in `edge-functions/` or `js/`, write and run a standalone simulation script in `scratch/` to verify upstream API response schemas, status codes, and edge-case behaviors against real payloads.

### 3.3 Syntax Verification Gate
- Run `node --check` across all modified JavaScript and Edge Function files before staging:
  ```bash
  node --check js/app.js && node --check js/chat.js && node --check js/plugins.js && node --check js/state.js && node --check edge-functions/api/plugins/*.js
  ```

---

## 4. Architecture & Plugin System Best Practices

### 4.1 Single Source of Truth for Tools
- `js/plugins.js` is the sole module defining client-side tool calling schemas, CoT reasoning markers, result formatters, and reference source card extractors.
- `js/chat.js` must remain completely generic, delegating all tool execution to `PluginRegistry`.

### 4.2 Serverless Edge Functions (`edge-functions/api/plugins/`)
- **Master Exception Boundary**: Wrap entire request handling in `try / catch (fatalErr)` blocks to guarantee the function returns clean `{ error, detail }` JSON and never triggers Tencent Cloud EdgeOne `HTTP 545` worker crashes.
- **Header & Secret Sanitization**: Always apply `.trim()` to secret environment variables (`OPENALEX_API_KEY`, `NEWSAPI_KEY`, `GITHUB_TOKEN`, etc.) to prevent whitespace-induced `TypeError: Invalid character in header content` failures.
- **Polite User-Agent**: Provide descriptive user-agent headers with contact email (e.g. `ZenMux-Chat-<Plugin>/X.Y (contact@zenmux.ai)`).

### 4.3 User-Facing Copywriting
- Do not use developer-centric jargon like `Function Calling` in UI text. Use natural, intuitive phrasing (e.g., *"开启的插件将注入模型决策流，模型在思考时可自主调度并执行"*).

---

## 5. Documentation & Style Guidelines

### 5.1 README.md Rules
- `README.md` must be clean, professional, and elegant.
- **Zero Emojis**: Do not use emojis anywhere in `README.md`. Use clean Markdown headings, bullet points, and tables.

### 5.2 Architectural Design Documentation
- Keep `design/design.md` updated with the latest system topology diagram (Mermaid) and the built-in plugin matrix whenever a new tool or gateway is introduced.
