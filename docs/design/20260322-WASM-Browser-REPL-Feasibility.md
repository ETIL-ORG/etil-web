# ETIL Browser REPL via WebAssembly — Feasibility Study

**Date:** 2026-03-22
**ETIL Version:** v1.6.0
**Scope:** Evaluate compiling the ETIL C++ interpreter to WebAssembly and running a client-side REPL in popular browsers

---

## Executive Summary

**Verdict: Feasible for a limited-feature REPL. Not viable as a feature-complete replacement for the native binary.**

The core interpreter (bytecode execution, stack operations, type system, 200+ primitives covering arithmetic, strings, arrays, maps, JSON, and non-temporal observables) is pure C++ with no OS-specific dependencies and can compile to WASM without modification. Five major subsystems have fundamental browser sandbox incompatibilities: async file I/O (libuv), MongoDB (TCP sockets + TLS), HTTP client (TLS + CORS), OpenBLAS/LAPACK (FORTRAN + SIMD), and temporal observable operators (thread blocking). These would need to be either removed, mocked, or reimplemented with JavaScript interop.

**Estimated binary size:** 5-7 MB gzipped (core interpreter + compatible primitives)
**Estimated memory:** 256 MB initial, sufficient for interactive use
**Estimated effort:** ~4 weeks for minimum viable browser REPL
**Recommended frontend:** xterm.js + vanilla TypeScript

---

## 1. Browser Memory Constraints

| Browser | 32-bit WASM | 64-bit WASM (Memory64) | Status |
|---------|-------------|----------------------|--------|
| Chrome | 4 GB | 16 GB | Fully supported |
| Firefox | 4 GB | 16 GB | Fully supported |
| Safari | 4 GB | Not yet | 32-bit only |

ETIL's interpreter with a 10,000-word dictionary, data stacks, and compiled bytecode uses well under 100 MB in typical sessions. A 256 MB WASM memory allocation is comfortable on all browsers. The `ALLOW_MEMORY_GROWTH` flag in Emscripten enables dynamic expansion up to the 4 GB 32-bit limit.

**Verdict:** Memory is not a constraint.

---

## 2. Dependency Analysis

### WASM-Compatible (No Changes Needed)

| Dependency | Role | WASM Status |
|------------|------|-------------|
| **Abseil** | `flat_hash_map`, mutexes, strings | Pure C++, compiles cleanly |
| **nlohmann/json** | JSON parsing/serialization | Header-only, pure C++ |
| **spdlog** | Logging | Redirect file sink to console |
| **Google Test/Benchmark** | Testing | Not needed in browser build |

### Hard Blockers (Must Be Removed or Reimplemented)

| Dependency | Role | Blocker | Mitigation |
|------------|------|---------|------------|
| **libuv** | Async file I/O, timers | No filesystem access, no OS threads | Remove; use Emscripten MEMFS/IDBFS |
| **OpenBLAS** | BLAS/LAPACK linear algebra | FORTRAN runtime, SIMD (AVX2) | Remove or replace with scalar fallback |
| **mongo-c-driver** | MongoDB CRUD | No TCP sockets from browser | Remove; flag words as unavailable |
| **mongo-cxx-driver** | MongoDB C++ wrapper | Same as above | Remove |
| **cpp-httplib** | HTTP client | No TLS from WASM, CORS restrictions | Replace with JS `fetch()` wrapper |
| **OpenSSL** | TLS, x.509, JWT signing | TLS handshake impossible from browser | Remove; delegate to JS layer |

### Can Be Skipped

| Dependency | Role | Action |
|------------|------|--------|
| **replxx** | REPL line editing | Skip; xterm.js provides editing |
| **jwt-cpp** | JWT authentication | Skip; no MCP server in browser |
| **TBB** | Thread Building Blocks | Skip; single-threaded WASM |

---

## 3. Subsystem Compatibility Matrix

### Core Interpreter — COMPATIBLE

The interpreter loop, bytecode compiler, dictionary, execution context, value types, and heap object system are pure C++ with no OS dependencies. `std::atomic` operations become no-ops in single-threaded WASM. `absl::Mutex` similarly degenerates to no-ops. The `ctx.tick()` amortized check loop works unchanged.

**Words retained:** All 136 core primitives (arithmetic, stack, comparison, boolean, logic, I/O, math, PRNG, memory, dictionary ops, metadata, help, execution tokens, type conversion, selection, evolution).

### String/Array/Map/JSON Primitives — COMPATIBLE

All 57 string, array, map, and JSON primitives are pure C++ computation with no OS dependencies.

**Words retained:** All 57 (20 string + 15 array + 8 map + 14 JSON).

### Observable Primitives — PARTIALLY COMPATIBLE

21 non-temporal observable operators (creation, transform, accumulate, limit, combine, terminal) work unchanged. 13 temporal operators (`obs-timer`, `obs-delay`, `obs-debounce-time`, etc.) depend on `std::this_thread::sleep_for()` and wall-clock timers, which cannot block the browser main thread.

**Words retained:** 21 of 34 non-temporal observable operators
**Words lost:** 13 temporal operators (could be reimplemented via JS `setTimeout`)

### Async File I/O — NOT COMPATIBLE

All 26 file I/O words (13 async + 13 sync) depend on libuv or POSIX filesystem calls. Browser WASM has no real filesystem access.

**Mitigation options:**
1. **Emscripten MEMFS** — In-memory virtual filesystem, lost on page refresh
2. **Emscripten IDBFS** — IndexedDB-backed persistence, survives page refresh
3. **OPFS** (Origin Private File System) — Modern API, limited browser support

A minimal LVFS implementation over MEMFS/IDBFS could support `read-file`, `write-file`, `ls`, `cat` for user scripts.

**Words lost:** All 26 file I/O words (could partially restore ~10 via MEMFS/IDBFS)
**Words lost:** All 6 LVFS words (could restore with mock filesystem)

### Matrix/LAPACK — NOT COMPATIBLE

All 43 matrix primitives link against OpenBLAS/LAPACKE. OpenBLAS is FORTRAN code with SIMD kernel dispatch (AVX2, SSE4). Compiling to WASM is theoretically possible via Emscripten's FORTRAN support but produces:
- 10-15 MB additional binary size
- 100x performance degradation (no SIMD in WASM, scalar fallback only)
- A 1000×1000 matrix multiply: native ~1ms → WASM ~100ms+

**Mitigation options:**
1. **Remove matrix words entirely** — Simplest, cleanest
2. **Scalar C++ fallback** — Naive loops, no BLAS. Small matrices only.
3. **JavaScript bridge to TensorFlow.js** — Full GPU acceleration via WebGL/WebGPU, but complex interop
4. **Eigen (header-only)** — Moderate performance, no FORTRAN, compiles to WASM

**Words lost:** All 43 matrix primitives (could restore basic ops via Eigen)

### MongoDB — NOT COMPATIBLE

Browser WASM cannot open TCP sockets. MongoDB's wire protocol requires raw TCP + TLS. No browser API provides this.

**Words lost:** All 5 `mongo-*` words

### HTTP — PARTIALLY COMPATIBLE (via JS)

`cpp-httplib` uses raw sockets internally. In browser context, HTTP must go through the `fetch()` API, subject to CORS restrictions.

**Mitigation:** Replace `http-get`/`http-post` with JavaScript `fetch()` wrapper via Emscripten's `emscripten_fetch()` or `EM_ASM` interop.

**Words retained:** 2 HTTP words (with JS reimplementation)

### Evolution/Selection — MOSTLY COMPATIBLE

The AST decompiler, compiler, stack simulator, type repair, genetic operators, and selection engine are pure C++. The fitness evaluation loop uses `ctx.tick()` for budget enforcement, which works in WASM. The only issue is wall-clock timing in `PerfProfile` — `std::chrono::steady_clock` works in WASM but with lower precision.

**Words retained:** All 7 selection/evolution words

---

## 4. Word Count Summary

| Category | Native | Browser WASM | Notes |
|----------|--------|-------------|-------|
| Core primitives | 136 | 136 | Full compatibility |
| String | 20 | 20 | Full compatibility |
| Array | 15 | 15 | Full compatibility |
| Byte array | 7 | 7 | Full compatibility |
| Map | 8 | 8 | Full compatibility |
| JSON | 14 | 14 | Full compatibility |
| Observable (non-temporal) | 21 | 21 | Full compatibility |
| Observable (temporal) | 13 | 0 | Need JS timer reimplementation |
| Observable (streaming I/O) | 7 | 0 | Need fetch() reimplementation |
| Handler words | 28 | 28 | Full compatibility |
| Self-hosted (builtins.til) | 18 | 18 | Full compatibility |
| Selection/Evolution | 7 | 7 | Full compatibility |
| Matrix/LAPACK | 43 | 0 | Need Eigen or removal |
| File I/O (async) | 13 | 0 | Need MEMFS/IDBFS |
| File I/O (sync) | 13 | 0 | Need MEMFS/IDBFS |
| LVFS | 6 | 0 | Need mock filesystem |
| MongoDB | 5 | 0 | Not viable in browser |
| HTTP | 2 | 2* | Via fetch() wrapper |
| MLP library | 9 | 0 | Depends on matrix words |
| **Total** | **~396** | **~276** | **~70% word coverage** |

---

## 5. Frontend Framework Recommendation

### Terminal Emulator: xterm.js

The industry standard for browser-based terminal UIs. Used by VS Code, Jupyter, Gitpod, and numerous WASM REPL projects (Python/Pyodide, Lua, Ruby). Provides:
- ANSI color/escape sequence support
- Copy/paste, selection
- Scrollback buffer
- Resize handling
- WebGL renderer for performance
- Addons: fit, search, serialize, web-links

### Application Shell: Vanilla TypeScript

For a REPL, the UI is simple: a terminal pane and possibly a file browser sidebar. No need for React's component model or Angular's DI framework. A vanilla TypeScript shell with xterm.js handles:
- WASM module loading and initialization
- Input routing (xterm → WASM stdin)
- Output capture (WASM stdout → xterm)
- File upload/download via drag-and-drop
- LocalStorage/IndexedDB for session persistence

### Why Not React/Angular?

- **React:** 30x slower initial render than vanilla DOM. Its virtual DOM diffing adds latency to terminal output. Overkill for a single-pane terminal.
- **Angular:** Full framework with DI, RxJS, and module system. 300KB+ bundle before ETIL WASM loads. Unnecessary complexity.
- **React Native:** Mobile framework. Not applicable to browser targets.

### Architecture

```
┌─────────────────────────────────────────┐
│  Browser Tab                             │
│                                          │
│  ┌──────────────────────────────────┐   │
│  │  xterm.js terminal               │   │
│  │  ┌────────────────────────────┐  │   │
│  │  │ ETIL v1.6.0 — WASM REPL   │  │   │
│  │  │ > 21 dup + .               │  │   │
│  │  │ 42                         │  │   │
│  │  │ > _                        │  │   │
│  │  └────────────────────────────┘  │   │
│  └──────────────────────────────────┘   │
│       ↕ stdin/stdout                     │
│  ┌──────────────────────────────────┐   │
│  │  TypeScript glue layer            │   │
│  │  - WASM module loader             │   │
│  │  - fetch() wrapper for http-*     │   │
│  │  - IDBFS sync for persistence     │   │
│  │  - File upload/download           │   │
│  └──────────────────────────────────┘   │
│       ↕ Emscripten API                   │
│  ┌──────────────────────────────────┐   │
│  │  ETIL WASM Module (~5-7 MB gz)    │   │
│  │  - Core interpreter               │   │
│  │  - 276 words                       │   │
│  │  - builtins.til + help.til         │   │
│  │  - MEMFS virtual filesystem        │   │
│  │  - 256 MB memory                   │   │
│  └──────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

---

## 6. Binary Size Estimates

| Component | Uncompressed | Gzipped |
|-----------|-------------|---------|
| Core interpreter + primitives | 8-12 MB | 3-4 MB |
| Abseil | 1-2 MB | 400 KB |
| nlohmann/json | 500 KB | 150 KB |
| spdlog | 200 KB | 60 KB |
| builtins.til + help.til | 100 KB | 30 KB |
| xterm.js + TS glue | 500 KB | 150 KB |
| **Total** | **~12-16 MB** | **~5-7 MB** |

After `wasm-opt -Oz`: additional 10-30% reduction.

For comparison: Pyodide (Python in WASM) downloads ~15 MB. SQLite WASM is ~3 MB. These are accepted sizes for interactive web tools.

---

## 7. Implementation Phases

### Phase 1: Emscripten Build System (1 week)

- Create `cmake/WasmToolchain.cmake`
- Add `ETIL_WASM_TARGET` CMake option
- Conditionally exclude: libuv, OpenBLAS, MongoDB, cpp-httplib, replxx, TBB, jwt-cpp
- Compile core interpreter to `.wasm` + `.js` loader
- Verify basic `interpret_line("21 dup + .")` works

### Phase 2: xterm.js Frontend (1 week)

- Set up xterm.js with TypeScript
- Wire stdin/stdout between xterm and WASM module
- Load `builtins.til` and `help.til` at startup
- Host as static site (GitHub Pages, Netlify, or S3)

### Phase 3: Virtual Filesystem with IDBFS (3-5 days)

- Implement MEMFS for session files
- Add IDBFS for persistent user scripts
- Restore `read-file`, `write-file`, `ls`, `cat` over virtual FS
- File upload via drag-and-drop into virtual FS
- Bulk export/import of `/home` as `.tar.gz` (see Section 11)

### Phase 4: HTTP via fetch() (2-3 days)

- Implement `http-get`/`http-post` via Emscripten Fetch API
- Handle CORS errors gracefully (user-facing message)

### Phase 5: Testing & Optimization (1 week)

- Run existing test suite against WASM build (exclude file/mongo/matrix tests)
- Optimize binary size with `wasm-opt -Oz`
- Performance benchmarks: native vs WASM for core operations
- Cross-browser testing (Chrome, Firefox, Safari)

### Total: ~4 weeks

---

## 8. What You'd Lose

| Feature | Impact | Alternative in Browser |
|---------|--------|----------------------|
| Matrix operations (43 words) | No linear algebra, no MLP | Could add Eigen later |
| MongoDB (5 words) | No database access | REST API proxy |
| Temporal observables (13 words) | No debounce/throttle/delay | JS setTimeout bridge |
| Streaming file/HTTP observables (7 words) | No streaming I/O | fetch() for HTTP |
| Async file I/O (26 words) | No real filesystem | MEMFS/IDBFS virtual FS |
| MLP library (9 words) | No neural networks | Depends on matrix words |
| LVFS navigation (6 words) | No filesystem browsing | Virtual FS mock |

---

## 9. Comparable Projects

| Project | Language | WASM Size | Notes |
|---------|----------|-----------|-------|
| Pyodide (Python) | C | ~15 MB | Full CPython in browser, widely used |
| SQLite WASM | C | ~3 MB | Full relational DB, official build |
| FFmpeg.wasm | C | ~20 MB | Video processing in browser |
| OpenCV.js | C++ | ~10 MB | Computer vision in browser |
| Lua WASM | C | ~200 KB | Minimal scripting language |

ETIL at 5-7 MB gzipped is comparable to these successful projects.

---

## 10. Recommendation

**Build a browser REPL as a demo/educational tool**, not as a production replacement for the native binary. The 70% word coverage (276 of ~396 words) is sufficient for:

- Learning FORTH/stack-based programming
- Demonstrating ETIL's type system and observables
- Running the evolution pipeline on synthetic test cases
- Interactive documentation (try examples from README directly in browser)

**Do not attempt** to replicate MongoDB, real filesystem access, or high-performance matrix operations in the browser build. These are server-side features that belong on ap1000.

**Frontend:** xterm.js + vanilla TypeScript. No React. No Angular.

**Hosting:** Static site on GitHub Pages (free, CDN-backed, HTTPS). No backend server needed.

---

## 11. IDBFS Persistent Filesystem — User Experience

### How It Works

From the user's perspective, the WASM REPL has a small persistent disk attached to their browser tab. The virtual filesystem is backed by two layers:

1. **MEMFS (in-memory)** — All file operations go here first. Fast, synchronous, but volatile.
2. **IDBFS (IndexedDB)** — Persistent backing store. Survives page refreshes, browser restarts, and OS reboots. Scoped to the browser + domain combination: Chrome on `etil.dev` sees different files than Firefox on `etil.dev`.

When the user first opens the REPL, the virtual filesystem starts with pre-populated example files (`help.til`, sample scripts). They write TIL code, save scripts with `write-file`, and those files persist transparently.

### User-Facing Commands

```
> ls                          # list files in current directory
> cat my-program.til          # print file contents
> include my-program.til      # load and execute a script
> write-file                  # save data to a file
> cd examples                 # navigate directories
> rm old-script.til           # delete a file
```

It behaves like a normal filesystem — except it's backed by IndexedDB instead of disk, and it's sandboxed to that browser/origin. The user cannot access files outside the sandbox — no reading `/etc/passwd`, no writing to `~/Documents`. The LVFS path resolution (`/home/`, `/library/`) maps to virtual directories inside IndexedDB, not the real OS filesystem.

### Synchronization

Emscripten's IDBFS requires an explicit `FS.syncfs()` call to flush in-memory changes to IndexedDB (writes go to MEMFS first, then persist on sync). The TypeScript glue layer fires `FS.syncfs()` automatically on:

- Every `write-file` / `append-file` completion
- Every `rm` / `mkdir` completion
- The browser `beforeunload` event (page close/refresh)
- A periodic 30-second heartbeat timer

The user never thinks about synchronization. If the browser crashes mid-write, the last sync point is what survives — similar to how a real filesystem can lose the last few writes on power failure.

### Storage Limits

Storage limits depend on the browser:

| Browser | Per-Origin Quota | Practical Limit |
|---------|-----------------|-----------------|
| Chrome | 60% of total disk | Often multiple GB |
| Firefox | 10% of disk (up to 2 GB) | ~200 MB - 2 GB |
| Safari | 1 GB default, user-prompted beyond | 1 GB without prompt |

For TIL scripts (typically < 100 KB each), this is effectively unlimited. Thousands of scripts fit comfortably.

### Bulk Export / Import

Users need the ability to export their entire `/home` directory as a portable archive and import it back — for backup, migration between browsers, or sharing with others.

**Export (`/export` meta-command or toolbar button):**

1. TypeScript glue walks the MEMFS `/home` tree recursively via Emscripten's `FS.readdir()` / `FS.readFile()`
2. Builds a `.tar.gz` archive in memory using a JavaScript tar library (e.g., [tar-js](https://github.com/niclasmattsson/tar-js)) or a minimal custom implementation (tar format is simple: 512-byte headers + file data)
3. Triggers a browser download dialog: `etil-home-YYYYMMDD-HHMMSS.tar.gz`
4. Archive preserves directory structure, file contents, and relative paths

**Import (`/import` meta-command or drag-and-drop):**

1. User selects a `.tar.gz` file via file picker or drags it onto the terminal
2. TypeScript glue decompresses (via `DecompressionStream` API or pako.js) and unpacks the tar archive
3. Files are written into MEMFS via `FS.writeFile()`, creating directories as needed via `FS.mkdir()`
4. A `FS.syncfs()` flush persists everything to IndexedDB
5. Confirmation message: "Imported N files into /home"

**Conflict handling:** Import overwrites existing files silently (last-write-wins). A future enhancement could prompt or merge.

**Size guard:** Import validates the decompressed size before writing. Reject archives that would exceed 50 MB decompressed to prevent filling IndexedDB quota.

### File Upload / Download (Individual)

In addition to bulk export/import:

- **Drag-and-drop upload** — User drags `.til` files from their desktop onto the browser window. The TypeScript glue reads them via the `File` API, writes to MEMFS at `/home/<filename>`, and syncs to IDBFS.
- **Download** — Right-click or `/download <file>` triggers a single-file download via `Blob` + `URL.createObjectURL()`.

### What the User Cannot Do

- Access files outside the `/home` and `/library` virtual directories
- Read the OS filesystem (no `/etc`, no `~/Documents`)
- Share files between different browsers or domains (IndexedDB is origin-scoped)
- Exceed the browser's per-origin storage quota (graceful error, not silent corruption)

---

## 12. Deployment via GitHub Pages + GitHub Actions

### Architecture

The WASM REPL is a fully static site — HTML, JavaScript, a `.wasm` binary, and bundled `.til` startup files. No backend server is needed. GitHub Pages serves these files over HTTPS with CDN caching.

The ETIL-ORG GitHub org already hosts the `etil` repo. Pages can be enabled under Settings > Pages > Source: GitHub Actions.

**URL:** `https://etil-org.github.io/etil/`

### GitHub Actions Workflow

A workflow triggers on push to a `wasm` branch (or manually via `workflow_dispatch`):

1. **Install Emscripten** — via `mymindstorm/setup-emsdk` action (caches the SDK across runs)
2. **Configure** — `emcmake cmake` with WASM-specific flags:
   - `-DETIL_WASM_TARGET=ON`
   - `-DETIL_BUILD_TESTS=OFF`
   - `-DETIL_BUILD_HTTP_CLIENT=OFF`
   - `-DETIL_BUILD_MONGODB=OFF`
   - `-DETIL_BUILD_JWT=OFF`
   - `-DCMAKE_BUILD_TYPE=Release`
3. **Build** — `ninja` produces `etil.wasm` + `etil.js` loader
4. **Optimize** — `wasm-opt -Oz` shrinks the binary (10-30% reduction)
5. **Assemble site** — Copy static assets into deploy directory:
   - `index.html` (xterm.js terminal page)
   - `etil.js` + `etil.wasm` (Emscripten output)
   - `glue.ts` → compiled `glue.js` (WASM ↔ xterm bridge)
   - `node_modules/xterm/` (or CDN link)
   - `data/builtins.til` + `data/help.til` (bundled startup files)
6. **Deploy** — `actions/deploy-pages@v4` publishes to GitHub Pages

### Workflow YAML (Scaffold)

```yaml
name: Deploy WASM REPL to GitHub Pages

on:
  push:
    branches: [wasm]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Emscripten
        uses: mymindstorm/setup-emsdk@v14
        with:
          version: 3.1.51

      - name: Configure
        run: |
          emcmake cmake -B build-wasm -GNinja \
            -DCMAKE_BUILD_TYPE=Release \
            -DETIL_WASM_TARGET=ON \
            -DETIL_BUILD_TESTS=OFF \
            -DETIL_BUILD_HTTP_CLIENT=OFF \
            -DETIL_BUILD_MONGODB=OFF \
            -DETIL_BUILD_JWT=OFF

      - name: Build
        run: ninja -C build-wasm

      - name: Optimize WASM
        run: wasm-opt -Oz build-wasm/etil.wasm -o build-wasm/etil.wasm

      - name: Assemble site
        run: |
          mkdir -p _site
          cp web/index.html _site/
          cp web/glue.js _site/
          cp build-wasm/etil.js _site/
          cp build-wasm/etil.wasm _site/
          cp -r data/builtins.til data/help.til _site/data/

      - name: Upload Pages artifact
        uses: actions/upload-pages-artifact@v3

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

### What's Needed Before This Works

1. **Phase 1 from Section 7** — Emscripten CMake toolchain (`cmake/WasmToolchain.cmake`) and `ETIL_WASM_TARGET` option that conditionally excludes incompatible dependencies
2. **Phase 2 from Section 7** — `web/index.html` with xterm.js and `web/glue.ts` TypeScript bridge
3. **Enable Pages** — GitHub repo Settings > Pages > Source: GitHub Actions
4. **Create `wasm` branch** — Or change the trigger to `main` once stable

The workflow YAML can be committed now as `.github/workflows/deploy-wasm.yml`. It won't run until the `wasm` branch exists and the Emscripten build system is implemented, but the CI scaffolding will be ready.

### Cost

GitHub Pages is free for public repos (ETIL-ORG/etil is public). GitHub Actions provides 2,000 free minutes/month for public repos. An Emscripten build takes ~5-10 minutes, so even daily pushes stay well within the free tier.
