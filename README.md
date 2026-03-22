# etil-web

Browser-based REPL for [ETIL](https://github.com/ETIL-ORG/etil) (Evolutionary Threaded Interpretive Language), compiled to WebAssembly via Emscripten.

## Status

**Early development** — Frontend scaffold complete, WASM compilation not yet implemented.

The mock interpreter allows UI development and testing. The real ETIL interpreter will be compiled to WASM in Stage 1.

## Architecture

```
Browser Tab
├── xterm.js terminal (UI)
├── TypeScript glue layer (WASM ↔ xterm bridge)
│   ├── WASM module loader
│   ├── stdin/stdout routing
│   ├── IDBFS sync for persistence
│   └── fetch() wrapper for http-* words
└── ETIL WASM Module (~5-7 MB gzipped)
    ├── Core interpreter (~276 words)
    ├── builtins.til + help.til
    ├── MEMFS virtual filesystem
    └── 256 MB WASM memory
```

## Tech Stack

- **WASM compilation:** Emscripten
- **Terminal UI:** [xterm.js](https://xtermjs.org/) v6
- **Glue layer:** Vanilla TypeScript
- **Bundler:** esbuild
- **Package manager:** pnpm
- **Persistence:** Emscripten IDBFS (IndexedDB-backed)
- **Deployment:** GitHub Pages via GitHub Actions

## Development

```bash
# Install dependencies
pnpm install

# Start dev server (http://localhost:8080)
pnpm dev

# Type check
pnpm typecheck

# Production build
pnpm build
```

## Word Coverage

The WASM build targets ~276 of ~396 ETIL words (70% coverage). Included:

- Core primitives (arithmetic, stack, comparison, logic, I/O, math)
- String, array, map, JSON, byte array operations
- Non-temporal observable operators
- Selection and evolution engine
- Handler words (control flow, definitions)
- Self-hosted words (builtins.til)

Excluded (browser sandbox incompatible):

- Matrix/LAPACK (OpenBLAS — FORTRAN + SIMD)
- MongoDB (TCP sockets + TLS)
- Async file I/O (libuv — OS threads)
- Temporal observable operators (thread blocking)

See `docs/design/20260322-WASM-Browser-REPL-Feasibility.md` for the full analysis.

## License

BSD-3-Clause
