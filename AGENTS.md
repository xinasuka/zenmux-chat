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

### 2.1 Single Source of Truth (SSOT) Versioning
Version management is centralized in `package.json` as the canonical Single Source of Truth (SSOT):
- Execute the version bump utility: `npm run bump patch`, `npm run bump minor`, or `node scripts/bump.js <target_version>`.
- The script automatically synchronizes `package.json` and `src/js/state.js` (`APP_VERSION`).
- `src/index.html` dynamically hydrates all `.app-version-badge` elements at runtime via `initApp()` in `src/js/app.js`. **Do not manually edit `src/index.html` for version increments.**

### 2.2 Version Badge UI Styling Rule
- The version badge in the sidebar header must remain minimalist and clean: compact font size, subtle text color, and **no background pill color**.

### 2.3 Commit Message Format
Every commit message must follow Conventional Commits and explicitly contain the semantic version tag:
- `feat(vX.Y.Z): add <feature description>`
- `fix(vX.Y.Z): resolve <bug description>`
- `refactor(vX.Y.Z): <refactoring scope>`
- `chore(vX.Y.Z): <maintenance scope>`
- `docs(vX.Y.Z): <documentation update>`

### 2.4 Atomic Commit & Remote Push Protocol
- **Lockstep Execution**: Commit and push operations must ALWAYS be executed together as a single atomic workflow.
- **Immediate Remote Synchronization**: Whenever changes are staged and committed, the agent must immediately execute `git push` to publish the revision to `origin/main` without waiting for separate user instructions.

---

## 3. Test-Driven Development (TDD) & Pre-Commit Verification

### 3.1 Scratch Test Directory
- Store all temporary test scripts, API simulation runners, and scratch validation code strictly under `scratch/` (e.g. `scratch/test_<feature>.js`).
- `scratch/` is ignored in `.gitignore` and must never be committed to Git.

### 3.2 Pre-Implementation Simulation
- Before modifying production files in `edge-functions/` or `src/js/`, write and run a standalone simulation script in `scratch/` to verify upstream API response schemas, status codes, and edge-case behaviors against real payloads.

### 3.3 Syntax Verification Gate
- Run `node --check` across all modified JavaScript and Edge Function files before staging:
  ```bash
  node --check src/js/app.js && node --check src/js/chat.js && node --check src/js/plugins.js && node --check src/js/state.js && node --check edge-functions/api/plugins/*.js
  ```

---

## 4. Architecture & Plugin System Best Practices

### 4.1 Single Source of Truth for Tools
- `src/js/plugins.js` is the sole module defining client-side tool calling schemas, CoT reasoning markers, result formatters, and reference source card extractors.
- `src/js/chat.js` must remain completely generic, delegating all tool execution to `PluginRegistry`.

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

### 5.2 Architectural Design Documentation & Strict Local-Only Invariant
- **Local-Only Master Specification (`design/design.md`)**:
  - `design/design.md` serves as a comprehensive private architectural workbook containing exhaustive internal specifications, mathematical formulations, and engineering notes.
  - **STRICTLY LOCAL-ONLY — NEVER UPLOAD TO GITHUB**: `design/design.md` must **NEVER** be staged, committed, or pushed to GitHub or remote repositories under any circumstances. It is permanently excluded via `.gitignore` (`design/*`). AI agents must **NEVER** modify `.gitignore` to unignore `design/design.md`, nor execute forced git additions (`git add -f`).
- **Canonical Public Specification (`design/arch.md`)**:
  - `design/arch.md` is the sole version-controlled architectural specification tracked in Git (`!design/arch.md`).
  - Keep `design/arch.md` synchronized with high-level system topology diagrams (Mermaid), subsystem paradigms, and plugin capabilities whenever new features or gateways are introduced.
