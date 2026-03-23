# Eigen Matrix Backend — Implementation Plan

**Date:** 2026-03-23
**References:** `20260323-Eigen-Matrix-Backend.md`
**Prerequisites:** Stages 0–6 complete. WASM build functional.
**Status:** Planned

---

## Stage 7: Eigen Matrix Backend

### 7.1 — Extract backend interface from matrix_primitives.cpp

- [ ] Create `include/etil/core/matrix_backend.hpp` with free functions for the 12 BLAS/LAPACKE-dependent operations:
  ```
  mat_multiply(A, B, C, M, N, K)
  mat_scale(data, scalar, n)
  mat_solve(A, b, x, n, nrhs) → bool
  mat_inverse(A, inv, n) → bool
  mat_determinant(A, n) → double
  mat_eigendecomp(A, eigenvalues, eigenvectors, n) → bool
  mat_svd(A, U, S, Vt, m, n) → bool
  mat_lstsq(A, b, x, m, n, nrhs) → bool
  mat_norm(A, m, n) → double
  mat_trace(A, n) → double
  mat_transpose(A, out, m, n)
  mat_col_sum(A, out, m, n)
  ```
- [ ] All functions take raw `double*` pointers + dimensions — no HeapMatrix or Eigen types in the interface
- [ ] Signature uses row-major layout convention (matches HeapMatrix)

### 7.2 — Create BLAS backend (native build)

- [ ] Create `src/core/matrix_backend_blas.cpp`
- [ ] Move the 12 BLAS/LAPACKE call sites from `matrix_primitives.cpp` into the backend functions
- [ ] `matrix_primitives.cpp` calls backend functions instead of CBLAS/LAPACKE directly
- [ ] Verify: native debug + release build, all matrix tests pass

### 7.3 — Create Eigen backend (WASM build)

- [ ] Add Eigen 3.4.0 to `cmake/Dependencies.cmake` (FetchContent, gated by `ETIL_WASM_TARGET`)
- [ ] Create `src/core/matrix_backend_eigen.cpp`
- [ ] Implement each backend function using Eigen:
  - `mat_multiply` → `Eigen::Map<RowMajorMatrix> * Eigen::Map<RowMajorMatrix>`
  - `mat_solve` → `A.colPivHouseholderQr().solve(b)`
  - `mat_inverse` → `A.inverse()`
  - `mat_determinant` → `A.determinant()`
  - `mat_eigendecomp` → `Eigen::SelfAdjointEigenSolver<>`
  - `mat_svd` → `Eigen::JacobiSVD<>`
  - `mat_lstsq` → `A.colPivHouseholderQr().solve(b)`
- [ ] Use `Eigen::Matrix<double, Dynamic, Dynamic, RowMajor>` throughout for HeapMatrix compatibility
- [ ] Use `Eigen::Map<>` for zero-copy wrapping of raw `double*` data

### 7.4 — CMake wiring

- [ ] Update `src/CMakeLists.txt`:
  ```cmake
  if(ETIL_WASM_TARGET)
      target_sources(etil PRIVATE
          core/matrix_primitives.cpp
          core/matrix_backend_eigen.cpp
      )
  else()
      target_sources(etil PRIVATE
          core/matrix_primitives.cpp
          core/matrix_backend_blas.cpp
      )
  endif()
  ```
- [ ] Remove the existing `if(NOT ETIL_WASM_TARGET)` gate around `matrix_primitives.cpp`
- [ ] Remove the `#ifndef ETIL_WASM_BUILD` guard around `register_matrix_primitives()` in `primitives.cpp`
- [ ] Verify: native build links BLAS backend, WASM build links Eigen backend

### 7.5 — WASM build + Node test

- [ ] Clean WASM rebuild with matrix words enabled
- [ ] Measure binary size impact (target: < 500 KB gzipped total)
- [ ] Node.js test:
  ```
  mat-new           → create matrix
  mat-eye           → identity matrix
  mat*              → multiplication
  mat+              → addition
  mat-scale         → scalar multiply
  mat-transpose     → transpose
  mat-solve         → linear solve
  mat-inv           → inverse
  mat-det           → determinant
  mat-relu          → activation function
  mat-sigmoid       → activation function
  mat.              → print matrix
  ```
- [ ] Verify all 43 mat-* words are registered (`words` output)

### 7.6 — MLP library test

- [ ] Copy `data/library/mlp.til` to embedded filesystem (already at `/data/library/`)
- [ ] Test in Node:
  ```
  library mlp.til
  # or: include /data/library/mlp.til

  # XOR network
  2 3 mat-randn make-layer
  3 1 mat-randn make-layer
  make-network

  # Verify forward pass doesn't crash
  2 1 mat-new forward mat.
  ```
- [ ] Full XOR training test (may need `random-seed` for reproducibility)

### 7.7 — Browser test

- [ ] Stage WASM artifacts (`pnpm stage:wasm`)
- [ ] Restart `pnpm dev`
- [ ] Browser tests:
  - `3 3 mat-eye mat.` — print 3x3 identity
  - `2 2 mat-new 1.0 0 0 mat-set 2.0 0 1 mat-set 3.0 1 0 mat-set 4.0 1 1 mat-set mat.` — manual matrix
  - `s" https://httpbin.org/get" map-new http-get` — verify http still works alongside matrix
  - `/ls` — verify IDBFS still works
  - MLP library load and XOR forward pass
- [ ] Verify no console errors
- [ ] Check binary size in status bar or DevTools Network tab

### 7.8 — Numerical precision validation

- [ ] Compare output of the 12 backend functions between BLAS and Eigen for known inputs:
  - 3x3 matrix multiply
  - 3x3 inverse
  - 3x3 determinant
  - 3x3 eigendecomposition
  - 3x2 SVD
  - 3x3 linear solve
- [ ] Document any precision differences (expected: < 1e-10 relative error)
- [ ] Widen test tolerances if needed for WASM build

### 7.9 — Commit and deploy

- [ ] Commit ETIL changes (backend extraction + Eigen backend) — super push with version bump
- [ ] Commit etil-web changes (CMake wiring, primitives.cpp guard removal)
- [ ] Push to both remotes
- [ ] Verify GitHub Pages deployment succeeds with matrix words

---

## Files to Create

| File | Purpose |
|------|---------|
| `include/etil/core/matrix_backend.hpp` | Backend interface (12 functions) |
| `src/core/matrix_backend_blas.cpp` | Native backend (OpenBLAS/LAPACKE) |
| `src/core/matrix_backend_eigen.cpp` | WASM backend (Eigen) |

## Files to Modify

| File | Change |
|------|--------|
| `src/core/matrix_primitives.cpp` | Call backend functions instead of CBLAS/LAPACKE directly |
| `src/CMakeLists.txt` | Select backend file based on `ETIL_WASM_TARGET` |
| `src/core/primitives.cpp` | Remove `#ifndef ETIL_WASM_BUILD` around `register_matrix_primitives()` |
| `cmake/Dependencies.cmake` | Add Eigen FetchContent (WASM only) |

## Files Unchanged

| File | Notes |
|------|-------|
| `etil-web/CMakeLists.txt` | Already sets `ETIL_WASM_TARGET=ON` |
| `etil-web/wasm/etil_wasm.cpp` | No changes needed — matrix words register via `register_primitives()` |

---

## Estimated Effort

| Step | Duration |
|------|----------|
| 7.1 Extract backend interface | 2 hours |
| 7.2 BLAS backend + verify native | 3 hours |
| 7.3 Eigen backend | 4 hours |
| 7.4 CMake wiring | 1 hour |
| 7.5 WASM build + Node test | 2 hours |
| 7.6 MLP library test | 1 hour |
| 7.7 Browser test | 1 hour |
| 7.8 Precision validation | 1 hour |
| 7.9 Commit + deploy | 30 minutes |
| **Total** | **~2 days** |
