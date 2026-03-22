# etil-web Implementation Plan

**Date:** 2026-03-22
**References:** `20260322-WASM-Browser-REPL-Feasibility.md`
**Status:** Active

---

## Stage 0: Environment Setup and Project Scaffolding

### 0.1 — Node.js / pnpm environment

- [x] Install Node.js 22 LTS
- [x] Install pnpm 10
- [x] Initialize git repo at `~/workspace/etil-web/`
- [x] Create `.gitignore` (CLAUDE.md, .claude/, build-wasm/, node_modules/, dist/)
- [x] Add `ap1000` remote (`ssh://claude@ap1000.alphapulsar.com/home/claude/git/etil-web`)
- [x] Reserve `origin` remote for GitHub (ETIL-ORG/etil-web)

### 0.2 — Frontend project scaffold

- [x] `pnpm init` — create `package.json`
- [x] Install dev dependencies:
  - `typescript` 5.9.3 — TypeScript compiler
  - `esbuild` 0.27.4 — fast bundler (no webpack complexity)
  - `@xterm/xterm` 6.0.0 — terminal emulator (v6, scoped package)
  - `@xterm/addon-fit` 0.11.0 — auto-resize terminal to container
  - `@xterm/addon-web-links` 0.12.0 — clickable URLs
- [x] Create `tsconfig.json` — target ES2022, strict mode, ESM modules
- [x] Create directory structure:
  ```
  web/
  ├── index.html          # Single-page app shell
  ├── src/
  │   ├── main.ts         # Entry point: init xterm, load WASM
  │   ├── glue.ts         # WASM ↔ xterm stdin/stdout bridge
  │   └── types.ts        # Emscripten module type declarations
  └── styles/
      └── terminal.css    # xterm.js styling + layout
  ```
- [x] Add `package.json` scripts:
  - `dev` — esbuild serve with watch mode (local development)
  - `build` — esbuild production bundle to `dist/`
  - `typecheck` — `tsc --noEmit`
- [x] Verify `pnpm dev` serves on port 8080, `pnpm build` produces 343K bundle, `pnpm typecheck` passes

### 0.3 — GitHub Actions scaffold

- [ ] Create `.github/workflows/deploy-wasm.yml` (from feasibility doc Section 12)
- [ ] Workflow triggers on `wasm` branch push + `workflow_dispatch`
- [ ] Placeholder steps (will fail until Emscripten build exists):
  - Setup Emscripten
  - Configure + build WASM (placeholder)
  - `pnpm install && pnpm build`
  - Assemble `_site/` directory
  - Deploy to GitHub Pages via `actions/deploy-pages@v4`

### 0.4 — Initial commit and push

- [ ] Commit scaffold with signed commit
- [ ] Push to `ap1000`
- [ ] Create `ETIL-ORG/etil-web` repo on GitHub
- [ ] Add `origin` remote and push

---

## Stage 1: Emscripten Build System

*Corresponds to feasibility doc Phase 1.*

### 1.1 — CMake toolchain for Emscripten

- [ ] Create `cmake/WasmToolchain.cmake`
  - Set `CMAKE_TOOLCHAIN_FILE` to Emscripten's
  - Define `ETIL_WASM_TARGET=ON`
  - Set WASM-specific flags: `-s WASM=1 -s ALLOW_MEMORY_GROWTH=1 -s TOTAL_MEMORY=256MB`
  - Enable `-fwasm-exceptions` (native WASM exceptions, smaller than JS-based)
  - Set `-Os` for size optimization
- [ ] Reference the `evolutionary-til/` source tree (symlink, submodule, or copy — decide approach)

### 1.2 — Conditional dependency exclusion in ETIL CMakeLists.txt

- [ ] Add `ETIL_WASM_TARGET` option to `evolutionary-til/CMakeLists.txt`
- [ ] When `ETIL_WASM_TARGET=ON`, skip:
  - libuv (async file I/O)
  - OpenBLAS / LAPACKE (matrix / LAPACK)
  - mongo-c-driver / mongo-cxx-driver (MongoDB)
  - cpp-httplib (HTTP client — will reimplement via fetch())
  - replxx (REPL line editing — xterm.js handles this)
  - TBB (threading)
  - jwt-cpp (JWT auth)
  - Google Test / Google Benchmark (testing)
- [ ] Guard affected source files with `if(NOT ETIL_WASM_TARGET)` in `src/CMakeLists.txt`
- [ ] Stub out excluded primitives: register words that push error string + `false`

### 1.3 — Emscripten compilation

- [ ] `emcmake cmake -B build-wasm -GNinja` with WASM flags
- [ ] Build produces `etil.wasm` + `etil.js`
- [ ] Export C functions for the glue layer:
  - `etil_init()` — create interpreter, load builtins.til + help.til
  - `etil_interpret(const char* line)` — interpret one line, return output
  - `etil_get_stack()` — return stack state as JSON string
- [ ] Verify: `node etil.js` (Emscripten's Node.js shim) can run `21 dup + .` → `42`

### 1.4 — Binary size optimization

- [ ] Run `wasm-opt -Oz` on output
- [ ] Measure gzipped size — target < 7 MB
- [ ] If oversized: identify bloated sections via `twiggy` or `wasm-objdump`
- [ ] Bundle `builtins.til` + `help.til` as embedded assets (Emscripten `--embed-file`)

---

## Stage 2: xterm.js Integration

*Corresponds to feasibility doc Phase 2.*

### 2.1 — Wire xterm.js to WASM module

- [ ] `main.ts`: Load WASM module via Emscripten's generated `etil.js` loader
- [ ] `glue.ts`: Bridge xterm.js input events to `etil_interpret()`
  - Accumulate keystrokes into a line buffer
  - On Enter: call `etil_interpret(line)`, write output to xterm
  - Handle backspace, cursor movement, line editing (xterm.js provides this)
- [ ] Route WASM stdout/stderr to xterm.js `terminal.write()`
- [ ] Display ETIL banner and `> ` prompt on startup

### 2.2 — Startup file loading

- [ ] Load `builtins.til` from embedded WASM filesystem
- [ ] Load `help.til` from embedded WASM filesystem
- [ ] Display word count after startup: `"276 words loaded"`

### 2.3 — Local development server

- [ ] `pnpm dev` serves the full REPL locally
- [ ] Hot-reload on TypeScript changes (esbuild watch mode)
- [ ] WASM binary served with correct MIME type (`application/wasm`)

---

## Future Stages (not yet detailed)

- **Stage 3:** IDBFS virtual filesystem + bulk export/import
- **Stage 4:** HTTP via fetch() wrapper
- **Stage 5:** Testing, optimization, cross-browser validation
- **Stage 6:** GitHub Pages deployment (activate workflow)

These will be planned in detail after gap reviews following Stage 2 completion.
