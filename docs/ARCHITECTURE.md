# Architecture, and adding a framework

SeamMap reads two projects, a **backend** and a **frontend**, and maps the code of each and the HTTP calls between
them. Today the backend is Laravel (PHP) and the frontend is Next.js (JS/TS). Everything framework-specific sits
behind two small interfaces, so supporting another framework (Django, Express, Rails, Nuxt, SvelteKit...) means
adding a folder and one line in a registry, not changing the pipeline, the matcher or the viewer.

## The pipeline

`analyze()` (`src/analyze.ts`) runs these stages, each for every project:

1. **scan:** list the source files (`src/scan.ts` does the walking: `.gitignore` files, skips, no symbolic links,
   unreadable folders skipped; the framework supplies the patterns and skip list).
2. **parse:** Tree-sitter syntax trees (`src/parse.ts`; native bindings in the CLI, WebAssembly in the editor
   extension, with identical results).
3. **extract:** definitions, imports, calls, routes, HTTP calls: the framework's adapter.
4. **resolve:** nodes and edges into the graph, endpoints and HTTP calls for the next stage: the adapter again.
5. **link:** match each frontend HTTP call to an endpoint (`src/link.ts`, `src/match/`). Generic: it only needs
   each endpoint's framework, for its side and its URL pattern.
6. **security** (with `--security`): the security lens, which is framework-specific (`src/security/`).

The output is `graph.json` (`src/types.ts`, format version in `src/schema.ts`). The viewer (`viewer/`) only reads
that file.

## The two interfaces

**`Adapter`** (`src/adapter.ts`): one project's stages. It owns all the language and framework knowledge: what a
definition is, how imports and calls resolve, where routes are declared, how HTTP calls are written.

**`Framework`** (`src/framework.ts`): what the rest of the program needs to know about a framework:

| Member | Used by | What it says |
| --- | --- | --- |
| `id`, `name`, `language`, `side` | everything; written to `graph.meta.frameworks` | `laravel`, `Laravel`, `PHP`, `backend` |
| `marker`, `isRoot(dir)` | monorepo detection (`findProjects`) | what makes a folder a project of it; must be cheap |
| `checkRoot(dir)` | `resolveRoots` | warnings for a root given explicitly that may not be one |
| `exclude(config)` | the pipeline | the exclude list a nested project's folder is added to |
| `createAdapter(...)` | the pipeline | its adapter |
| `endpointPattern(path)` | the link stage | its route syntax (`/users/{id}`, `/users/[id]`) as URL segments |

`src/frameworks.ts` lists the frameworks. For a project root, the first framework of its side whose `isRoot`
recognizes it is used; the first of each side is the default.

## Adding a framework

1. **Adapter.** In `src/lang/<language>/` (reuse the folder if the language is already supported), implement
   `Adapter`. Node ids are `be:` / `fe:` plus the file path relative to the root (and `#name` / `::method` for
   definitions); endpoints are `endpoint:<framework id>:<METHOD> <pattern>`. Paths in the graph are relative POSIX
   paths. Output must be deterministic: sort everything, never depend on the machine. Read source files with
   `parseFile` / `readSource` (byte-order marks and line endings normalized). A file that can't be read or parsed
   is a warning and a parse error, never a crash.
2. **Framework.** Next to the adapter, a `framework.ts` exporting the `Framework` object.
3. **Register** it in `src/frameworks.ts`, and add its id to `FrameworkId` in `src/types.ts`.
4. **Config.** If it has options, a section named after its id in `src/config.ts` (with its keys in
   `KNOWN_KEYS`), with `include` / `exclude` like the others.
5. **Tree-sitter grammar.** Add the grammar package (native and `.wasm`): `src/parse.ts` (`LangId`, `langForFile`),
   `src/wasm-runtime.ts` (`GRAMMAR_WASM`), `scripts/vendor-native.mjs` (`GRAMMARS`), and the extension build copies
   its `.wasm`.
6. **Tests.** A fixture project in `fixtures/`, added to `FIXTURE` in `test/frameworks.test.ts`, which checks the
   contract (prefixes, relative paths, endpoints, determinism) for every registered framework, and tests of its
   own extraction like `test/php-extract.test.ts` and `test/js-extract.test.ts`. Run the whole suite on both parser
   runtimes: `npm test` and `CODEMAP_PARSER=wasm npm test`.
7. **Viewer.** Lane titles, the endpoint groups' names and file languages come from `graph.meta.frameworks`; a new
   framework needs nothing for those. Its role groups (controllers, models, pages...) reuse the existing ones where
   they fit (`viewer/theme.js`, `GROUPS`; backend roles come from the adapter's `role` field).
8. **Docs and versioning.** A new framework is an addition (a minor release): new values for `server` and
   `meta.frameworks`. List it in the changelog under **Added**, and its scanning rules in the README.

The security lens is per framework (`src/security/`, Laravel and Next.js today) and optional: a framework without
one still gets the full map.

## Where things are decided

* **One project per side.** A backend and a frontend; the map has three lanes (backend, endpoints, frontend).
  Endpoints of the frontend's own server (Next.js route handlers) sit in the middle lane with the backend's.
* **Matching** (`src/match/match.ts`) works on roles, not frameworks: a relative URL is tried against the
  frontend's own handlers first, then the backend; a URL with the backend's base against the backend.
* **What is certain.** An edge is `certain` only when the syntax alone proves it. Anything inferred is
  `certain: false`, and anything dropped is counted in the stats (`unresolvedByReason`) and sampled in
  `diagnostics`. Keep that rule for a new framework: a wrong edge is worse than a missing one.
