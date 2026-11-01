# Changelog

All notable changes to SeamMap, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and version numbers follow the
[versioning policy](README.md#versioning).

Each release lists only the sections it needs, in this order: **Added**, **Changed**, **Deprecated**,
**Removed**, **Fixed**, **Security** (fixes to SeamMap itself), and **Results may differ**: every change in what
the analysis finds for unchanged code (edges, endpoints, protection states, findings, stats), so that anyone
comparing `graph.json` files across versions knows which differences come from the tool. Breaking changes start
with **Breaking:**.

## [Unreleased]

### Added

- `meta.frameworks` in `graph.json`: the framework analyzed on each side (`id`, `name`, `language`), or `null`. The
  viewer names its lanes, endpoint groups and file languages from it.
- `nextKind: "proxy"` for Next.js 16's `proxy.ts`, like `middleware.ts`.
- `loadConfig()` returns `warnings` (unknown keys), and `resolveRoots()` takes an optional `origin` for its error
  messages. `FrameworkId` and `FrameworkInfo` types.
- `docs/ARCHITECTURE.md`: how the pipeline works and how to add a framework.
- Viewer: clusters when zoomed out on large maps, like map marker clusters. Below about 40% zoom, each role group
  becomes one bubble with its card count and name, and bubbles of one lane that would overlap merge (they split as
  you zoom in). One line per pair of bubbles, both directions together, replaces the edges between their cards; its
  width and opacity follow the number of links, and it bends around bubbles in its way. Hover a bubble or a line
  for details (both directions, counts by edge kind, uncertain links, the busiest pairs of cards); click to zoom
  in. A focused chain stays visible as cards. Large maps open fitted whole this way, with the suggested start's
  group haloed. **View** menu → **Group cards when zoomed out** turns it off. Panning the whole map is about
  4–5× less work, and its slowest frames went from 0.87 s to 17 ms on a 6,564-card map.

### Changed

- Frameworks plug in through one registry (`src/frameworks.ts`): detection, the pipeline and the link stage no
  longer name Laravel or Next.js. Output is unchanged.
- Viewer redesign: neutral grey chrome (black and white buttons) so the map's colours stand out; Inter and
  JetBrains Mono (two variable font files instead of eight); segmented panel tabs; glass docks on the canvas.
  Text meets WCAG AA contrast in both themes; the panel's tabs shrink to icons when they don't fit; narrow windows
  start with the panel closed.
- Viewer top bar: 14 controls down to 5. Focus depth, layout, collapse all, re-layout and the theme move into a
  **View** menu (`V`), reachable at every window width (narrow windows used to hide some of them). **Isolate**,
  **Expand** and **Open** move to a selection bar shown over the map when a card is selected (and stay in the panel
  and on `I`, `E`, `O`). The isolation toast is gone: the selection bar and the status bar show it.
- HTTP-method badges on cards are drawn in the system sans-serif, crisp on every OS (they were a generic
  monospace, Courier on Windows).
- Config files: an unknown key is a warning with the closest known key; a file or section of the wrong type, or an
  `include` pattern outside the project, is an error that names the file and the key.
- Monorepo detection counts a folder as a Next.js app only with `next` as a dependency and `app/`, `pages/` or a
  `next.config` file, so libraries that build on Next no longer make it ambiguous.

### Fixed

- Symbolic links are no longer followed: a link loop made the scan hang, and links out of the project were read.
- An unreadable folder anywhere in a project (a Docker volume, a path too long) no longer stops the run.
- Route files in modules and packages (`modules/Blog/Routes/web.php`) and routes registered by any service provider
  or with `loadRoutesFrom()` are read; they were missing, or reported as "not found or not scanned".
- A `require` of a non-route file in `bootstrap/app.php` is no longer reported as a missing route file.
- A route file nested too deeply to read is reported instead of stopping the run.
- The Security tab and the Lens button no longer show for graphs without the security lens; the Filters tab no
  longer shifts the panel sideways; a graph with nothing in it explains what was scanned.
- A project nested in the other with `#`, `!` or `[` in its folder name is kept apart from it.
- The same folder given as backend and frontend through a link is caught.
- Clearer messages: an unreadable `composer.json` or `.gitignore`, a project path from the config file that doesn't
  exist, an output folder that can't be written, a side with no files to analyze.
- PHP method lookup is no longer quadratic on very large classes.

### Results may differ

- `.gitignore` files of the folders above the project, up to the repository root, apply now, as in git (unless they
  ignore the analyzed folder itself), so files they ignore are no longer analyzed.
- Laravel routes in modules' and packages' route folders, and routes loaded by service providers, appear on the map.
- A non-literal route prefix is kept as a `{prefix}` segment instead of being dropped, so those routes' paths and
  ids change, and frontend calls can match them.
- Two Laravel routes that differ only in parameter names: the map keeps the first (as Laravel matches) instead of
  the last.
- `tsconfig` path aliases into folders outside the project (a monorepo's packages) count as external imports, not
  unresolved ones.
- PHP files over 2 MB are skipped without counting as parse errors, as on the frontend.

## [1.0.0] - 2026-10-25

First public release.

### Added

- **Analysis** of a Laravel backend and a Next.js frontend (App and Pages Router) into one `graph.json`: files,
  classes, functions, methods and components; imports, calls and renders; Laravel routes and Next.js route
  handlers as endpoints, with the frontend's `fetch` and axios calls matched to them. Deterministic and offline:
  it reads the source and never runs either project.
- **Viewer** on `localhost`: Laravel, endpoint and Next.js lanes, focus and isolate, search by name, path or URL,
  orthogonal edge routing, open in VS Code, light and dark themes.
- **Security lens** (`--security`), a review aid and not a scanner: the protection state of each Laravel route,
  Next.js route handler and server action (middleware, policies, checks in code, `middleware.ts` matchers),
  import of SARIF results from your own scanners, and local pattern checks.
- **Command line:** monorepo detection, `--json-only`, `--list`, `seammap.config.json`, exit codes `0` and `1`.
- **Programmatic API:** `analyze()`, `findConfig()`, `loadConfig()`, `defaultConfig()`, `resolveRoots()`, `findProjects()`,
  `checkSchema()`, `VERSION`, `SCHEMA_VERSION`, and TypeScript types for `graph.json`.
- **Format version:** `graph.json` starts with `schemaVersion` (`1`), which changes only on incompatible format
  changes. The viewer explains files with another format version, or none, instead of drawing them.
- **Packaging:** prebuilt parsers for Linux, macOS and Windows on x64 and arm64 (and Alpine on x64), for
  Node.js 20 or newer; no install scripts, nothing to compile.
- **Config lookup that follows the projects:** without `--config`, the nearest `seammap.config.json` in or above
  the backend and frontend roots, up to the repository root, is used, wherever the command runs. When several are
  found, the one naming the analyzed projects wins. The summary always says which file was used and why, or
  where it looked; `findConfig()` exposes the rule.
- `meta.config` in `graph.json`: the config file used (relative to the backend root) and a hash of its settings,
  or `null`.
- **First step for the security lens:** when a few middleware (at most five) are all that keeps most unknown
  endpoints unknown, the summary, the Security tab and the "Start with" suggestion lead with them and a
  ready-to-edit snippet, with an exact count (`security.classifyFirst` in `graph.json`). States never change
  until you classify them.
- **First view of large maps:** fitted to the width of the lanes with readable group titles, with the suggested
  start scrolled into view and haloed.
- **VS Code extension** (`extension/`): **Open Map** analyzes the workspace in a background process with progress
  and cancel and shows the map in an editor tab; cards open their file at the right line beside it; the active
  editor's file is highlighted, and **Show Current File on Map** selects it; the status bar says when the map is
  out of date, and **Refresh Map** redoes it; the map follows the editor's theme. Settings for the backend,
  frontend, config file and security lens act like the CLI's options, and the config file is found by the same
  rule. One universal package for every platform and for remote development, Restricted Mode support (the
  workspace config's `security` section is then ignored), no network requests.
- The analyzer runs on either Tree-sitter runtime: the native bindings (the CLI) or WebAssembly (the extension),
  with identical results; the whole test suite runs on both. A WebAssembly runtime that runs out of memory stops
  the analysis with a message instead of skipping the rest of the project.
- `analyze()` takes an `onStage` callback for progress.

[Unreleased]: https://github.com/ianjohndal5/CodeMap/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/ianjohndal5/CodeMap/releases/tag/v1.0.0