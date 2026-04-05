# etil-web

Browser-based REPL for [ETIL](https://github.com/ETIL-ORG/etil) (Evolutionary Threaded Interpretive Language), compiled to WebAssembly via Emscripten.

## **Live:** [https://etil-org.github.io/etil-web/](https://etil-org.github.io/etil-web/)

## Features

- Full ETIL interpreter running client-side in the browser — no server required
- 250+ TIL words: arithmetic, stack, strings, arrays, maps, JSON, observables, matrix/linear algebra, selection, evolution
- Persistent filesystem (IndexedDB) — files survive page refreshes
- Command history (500 lines, persistent across sessions)
- `http-get` / `http-post` with native TIL stack signature via async fetch bridge
- File management: `/upload`, `/download`, `/export`, `/import`, drag-and-drop
- Dark terminal theme with line editing, arrow key history, cursor movement

## Architecture

```
Browser Tab
├── xterm.js terminal (UI)
├── TypeScript glue layer
│   ├── WASM module loader
│   ├── stdin/stdout routing
│   ├── IDBFS sync for persistence
│   ├── fetch() bridge for http-get/http-post
│   └── File management (upload/download/export/import)
└── ETIL WASM Module (~1.3 MB, ~416 KB gzipped)
    ├── Core interpreter + Eigen matrix backend
    ├── builtins.til + help.til + mlp.til
    ├── MEMFS + IDBFS virtual filesystem
    └── 256 MB WASM memory
```

## Quick Start

```bash
pnpm install
pnpm dev          # http://localhost:8080
```

See [BUILD_INSTRUCTIONS.md](BUILD_INSTRUCTIONS.md) for full build details including WASM compilation.

### Design, Plan and Review Documents

See the [https://github.com/ETIL-ORG/etil-web/tree/master/docs/design](https://github.com/ETIL-ORG/etil-web/tree/master/docs/design) directory.

## Commands

| Command | Description |
|---------|-------------|
| `/help` | Show all commands |
| `/words` | List dictionary words |
| `/clear` | Clear terminal |
| `/stack` | Show data stack |
| `/ls [path]` | List files in /home |
| `/upload` | Upload .til files |
| `/download <path>` | Download a file |
| `/export` | Export /home as JSON |
| `/import` | Import JSON archive |
| `/get <url>` | HTTP GET (display response) |
| `/post <url> <body>` | HTTP POST (display response) |
| `/reset` | Clear stack, cancel colon defs in progress |
| `/version` | Show version info |

TIL words `http-get` and `http-post` are also available with the native stack signature:
```
s" https://httpbin.org/get" map-new http-get   # ( -- body status flag )
```

## Word Coverage

~250 of ~396 native ETIL words are available in the browser build.

**Included:** core primitives, strings, arrays, maps, JSON, byte arrays, non-temporal observables, 46 matrix/linear algebra words (via Eigen backend), MLP neural network library, selection engine, evolution engine, LVFS navigation, handler words, self-hosted builtins.

**Excluded (browser sandbox):** MongoDB, async file I/O (libuv), temporal observables.

## Tech Stack

- **WASM:** [Emscripten](https://emscripten.org/) 5.0
- **Terminal:** [xterm.js](https://xtermjs.org/) 6.0
- **Language:** TypeScript (vanilla, no framework)
- **Bundler:** [esbuild](https://esbuild.github.io/)
- **Package Manager:** pnpm
- **Persistence:** Emscripten IDBFS (IndexedDB)
- **Deployment:** GitHub Pages via GitHub Actions

## Versioning

etil-web is versioned independently from the ETIL interpreter:

- **Interpreter version** — from the compiled ETIL C++ source (e.g., v1.6.2)
- **Web version** — from `package.json` (e.g., v1.0.1)

Both versions are displayed in the startup banner.

## License

[BSD-3-Clause](LICENSE.md)
