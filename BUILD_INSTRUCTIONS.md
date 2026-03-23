# Build Instructions

## Prerequisites

- **Node.js 22+** — [nodejs.org](https://nodejs.org/)
- **pnpm** — `npm install -g pnpm`
- **Emscripten SDK** — for WASM compilation (optional for frontend-only development)

### Emscripten Setup (one-time)

```bash
cd ~/workspace
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
./emsdk install latest
./emsdk activate latest
source ./emsdk_env.sh
```

## Quick Start (frontend only, mock interpreter)

```bash
pnpm install
pnpm dev          # http://localhost:8080
```

## Full Build (WASM + frontend)

### 1. ETIL Source

The WASM build requires the ETIL C++ source tree. Create a symlink:

```bash
ln -s /path/to/evolutionary-til etil-src
```

### 2. Build WASM

```bash
source ~/workspace/emsdk/emsdk_env.sh
emcmake cmake -B build-wasm -GNinja -DCMAKE_BUILD_TYPE=Release
ninja -C build-wasm
```

### 3. Stage WASM Artifacts

```bash
pnpm stage:wasm
```

### 4. Build Frontend

```bash
pnpm build
```

### 5. Development Server

```bash
pnpm dev          # http://localhost:8080 with watch mode
```

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start dev server on port 8080 with watch mode |
| `pnpm build` | Production build to `web/dist/` |
| `pnpm typecheck` | TypeScript type checking |
| `pnpm stage:wasm` | Copy WASM artifacts from `build-wasm/` to `web/wasm/` |

## Output

The WASM build produces:
- `build-wasm/etil.js` — Emscripten JS loader (~68 KB)
- `build-wasm/etil.wasm` — WebAssembly binary (~1.2 MB, ~340 KB gzipped)

The frontend build produces:
- `web/dist/main.js` — Bundled application (~350 KB)
- `web/dist/main.css` — Bundled styles (~5 KB)

## Deployment

Push to `master` triggers GitHub Actions workflow that builds and deploys to GitHub Pages at `https://etil-org.github.io/etil-web/`.
