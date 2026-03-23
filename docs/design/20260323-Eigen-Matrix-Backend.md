# Eigen Matrix Backend for WASM Build

**Date:** 2026-03-23
**References:** `20260322-WASM-Browser-REPL-Feasibility.md` (Section 3, Matrix subsystem)
**Status:** Proposed

---

## Problem

The WASM build excludes all 43 matrix primitives because they depend on OpenBLAS/LAPACKE:

- OpenBLAS contains FORTRAN code requiring a FORTRAN runtime in WASM (+10-15 MB)
- BLAS kernels use SIMD (AVX2/SSE4) which WASM doesn't support — scalar fallback is ~100x slower
- LAPACKE headers and link targets are unavailable without the full OpenBLAS build

This means the MLP library (`mlp.til`), all `mat-*` words, and any matrix-based evolution demos are unavailable in the browser REPL.

---

## Proposed Solution: Eigen (Header-Only C++)

[Eigen](https://eigen.tuxfamily.org/) is a header-only C++ linear algebra library that:

- Has **no external dependencies** — no FORTRAN, no BLAS, no LAPACK
- Compiles cleanly with **Emscripten/clang** (widely used in WASM projects including TensorFlow Lite)
- Covers **all operations** ETIL's matrix primitives use
- Adds **zero binary size** beyond what's actually called (header-only, dead code eliminated)
- Is **BSD-3-Clause** licensed (compatible with ETIL)

### Performance Characteristics

| Matrix Size | OpenBLAS (native) | Eigen (WASM) | Ratio |
|-------------|-------------------|--------------|-------|
| 10x10 multiply | ~0.001 ms | ~0.01 ms | ~10x |
| 100x100 multiply | ~0.1 ms | ~2 ms | ~20x |
| 1000x1000 multiply | ~10 ms | ~500 ms | ~50x |

For interactive REPL use (small matrices, educational demos), the performance is acceptable. The MLP XOR training demo uses 2x3 and 3x1 matrices — Eigen handles these in microseconds.

---

## API Mapping

Every ETIL matrix primitive maps directly to an Eigen operation:

### Creation / Conversion (6 words)

| ETIL Word | OpenBLAS Implementation | Eigen Equivalent |
|-----------|------------------------|------------------|
| `mat-new` | `HeapMatrix(rows, cols)` | Same (no BLAS dependency) |
| `mat-eye` | Manual loop | `Eigen::MatrixXd::Identity(n, n)` |
| `mat-rand` | `prng_engine()` loop | Same (no BLAS dependency) |
| `mat-randn` | Box-Muller loop | Same (no BLAS dependency) |
| `mat-diag` | Manual loop | `v.asDiagonal()` |
| `array->mat` | Manual copy | Manual copy (same) |

### Arithmetic (6 words)

| ETIL Word | OpenBLAS | Eigen |
|-----------|----------|-------|
| `mat*` | `cblas_dgemm()` | `A * B` |
| `mat+` | Manual loop | `A + B` |
| `mat-` | Manual loop | `A - B` |
| `mat-scale` | `cblas_dscal()` | `A * scalar` |
| `mat-hadamard` | Manual loop | `A.cwiseProduct(B)` |
| `mat-add-col` | Manual loop | `A.colwise() + v` |

### Decomposition / Solve (6 words)

| ETIL Word | LAPACKE | Eigen |
|-----------|---------|-------|
| `mat-solve` | `LAPACKE_dgesv()` | `A.colPivHouseholderQr().solve(b)` |
| `mat-inv` | `LAPACKE_dgetrf()` + `LAPACKE_dgetri()` | `A.inverse()` |
| `mat-det` | `LAPACKE_dgetrf()` + product of diag | `A.determinant()` |
| `mat-eigen` | `LAPACKE_dsyev()` | `Eigen::SelfAdjointEigenSolver<>(A)` |
| `mat-svd` | `LAPACKE_dgesvd()` | `Eigen::JacobiSVD<>(A)` |
| `mat-lstsq` | `LAPACKE_dgels()` | `A.colPivHouseholderQr().solve(b)` |

### Access / Query (9 words)

| ETIL Word | Notes |
|-----------|-------|
| `mat-get`, `mat-set` | Direct element access — no BLAS |
| `mat-rows`, `mat-cols` | Dimension query — no BLAS |
| `mat-row`, `mat-col`, `mat-col-vec` | Slice extraction — no BLAS |
| `mat-transpose` | `A.transpose()` |
| `mat.` | Print — no BLAS |

### Reduction (6 words)

| ETIL Word | Eigen |
|-----------|-------|
| `mat-sum` | `A.sum()` |
| `mat-col-sum` | `A.colwise().sum()` |
| `mat-mean` | `A.mean()` |
| `mat-norm` | `A.norm()` |
| `mat-trace` | `A.trace()` |
| `mat-clip` | `A.cwiseMax(lo).cwiseMin(hi)` |

### Activation Functions (6 words)

| ETIL Word | Notes |
|-----------|-------|
| `mat-relu`, `mat-sigmoid`, `mat-tanh` | Element-wise — no BLAS dependency |
| `mat-relu'`, `mat-sigmoid'`, `mat-tanh'` | Element-wise derivatives — no BLAS dependency |

### Classification (3 words)

| ETIL Word | Notes |
|-----------|-------|
| `mat-softmax` | Element-wise + reduction — no BLAS dependency |
| `mat-cross-entropy` | Element-wise + reduction — no BLAS dependency |
| `mat-apply` | Execute xt per element — no BLAS dependency |

### Serialization (2 words)

| ETIL Word | Notes |
|-----------|-------|
| `mat->json`, `json->mat` | JSON conversion — no BLAS dependency |
| `mat->array` | Array conversion — no BLAS dependency |

---

## Key Observation

Of the 43 matrix words, only **12 actually use BLAS/LAPACKE**:

- **BLAS:** `mat*` (dgemm), `mat-scale` (dscal)
- **LAPACKE:** `mat-solve` (dgesv), `mat-inv` (dgetrf+dgetri), `mat-det` (dgetrf), `mat-eigen` (dsyev), `mat-svd` (dgesvd), `mat-lstsq` (dgels)
- **BLAS-optional:** `mat+`, `mat-`, `mat-hadamard`, `mat-add-col` (currently manual loops, not BLAS calls)

The remaining 31 words are pure C++ with no external dependencies — they already compile in WASM but are excluded because the entire `matrix_primitives.cpp` file is gated.

---

## Implementation Approach

### Option A: Dual Backend in matrix_primitives.cpp

```cpp
#ifdef ETIL_WASM_BUILD
    #include <Eigen/Dense>
    // Use Eigen for the 12 BLAS/LAPACKE-dependent operations
#else
    #include <cblas.h>
    #include <lapacke.h>
    // Use OpenBLAS (current implementation)
#endif
```

**Pros:** Single source file, no code duplication, conditional compilation.
**Cons:** `#ifdef` blocks throughout the file, harder to read.

### Option B: Separate Eigen Backend File

```
src/core/matrix_primitives.cpp          # Current (OpenBLAS)
src/core/matrix_primitives_eigen.cpp    # WASM (Eigen)
```

CMakeLists.txt selects which file to compile:
```cmake
if(ETIL_WASM_TARGET)
    target_sources(etil PRIVATE core/matrix_primitives_eigen.cpp)
else()
    target_sources(etil PRIVATE core/matrix_primitives.cpp)
endif()
```

**Pros:** Clean separation, each file is self-contained.
**Cons:** Code duplication for the 31 non-BLAS words.

### Option C: Extract BLAS-Dependent Code (Recommended)

Refactor `matrix_primitives.cpp` to isolate the 12 BLAS/LAPACKE calls into a small backend interface:

```cpp
// matrix_backend.hpp
namespace etil::core {
    // Only the operations that differ between backends
    void mat_multiply(const double* A, const double* B, double* C,
                      int M, int N, int K);
    void mat_scale(double* A, double scalar, int n);
    bool mat_solve(const double* A, const double* b, double* x, int n, int nrhs);
    bool mat_inverse(const double* A, double* inv, int n);
    double mat_determinant(const double* A, int n);
    // ... (6 more)
}

// matrix_backend_blas.cpp   — implements via cblas/lapacke
// matrix_backend_eigen.cpp  — implements via Eigen
```

CMakeLists.txt selects the backend:
```cmake
if(ETIL_WASM_TARGET)
    target_sources(etil PRIVATE core/matrix_backend_eigen.cpp)
else()
    target_sources(etil PRIVATE core/matrix_backend_blas.cpp)
endif()
```

**Pros:** Minimal duplication (~50 lines of backend code), `matrix_primitives.cpp` unchanged, clean SOC.
**Cons:** New abstraction layer.

---

## Eigen Integration

### FetchContent

```cmake
if(ETIL_WASM_TARGET)
    FetchContent_Declare(
        eigen
        URL https://gitlab.com/libeigen/eigen/-/archive/3.4.0/eigen-3.4.0.tar.gz
        URL_HASH SHA256=8586084f71f9bde545ee7fa6d00288b264a2b7ac3607b974e54d13e7162c1c72
        DOWNLOAD_EXTRACT_TIMESTAMP TRUE
    )
    FetchContent_MakeAvailable(eigen)
    target_link_libraries(etil PUBLIC Eigen3::Eigen)
endif()
```

Eigen 3.4.0 is ~6 MB download, header-only — only compiled headers add to the WASM binary.

### Binary Size Impact

Estimated addition to WASM binary from Eigen-backed matrix ops:

| Component | Size (uncompressed) | Size (gzipped) |
|-----------|--------------------|-|
| Current WASM (no matrix) | 1.2 MB | 340 KB |
| Eigen matrix backend | +200-400 KB | +60-120 KB |
| **Total** | **~1.5 MB** | **~450 KB** |

Still well under the 7 MB target from the feasibility study.

---

## HeapMatrix Compatibility

ETIL's `HeapMatrix` stores data as `std::vector<double>` in row-major order. Eigen's `MatrixXd` uses column-major by default. Two options:

1. **Use `Eigen::Matrix<double, Dynamic, Dynamic, RowMajor>`** — matches HeapMatrix layout, zero-copy via `Eigen::Map`
2. **Transpose on copy** — convert between row-major HeapMatrix and column-major Eigen

Option 1 is strongly preferred. `Eigen::Map` wraps existing memory without copying:

```cpp
// Zero-copy: wrap HeapMatrix data as Eigen matrix
Eigen::Map<Eigen::Matrix<double, Eigen::Dynamic, Eigen::Dynamic, Eigen::RowMajor>>
    eigenA(matrix->data(), matrix->rows(), matrix->cols());
```

---

## What This Enables in the Browser

With matrix words restored:

- **MLP library** (`include /library/mlp.til`) — feedforward neural networks
- **XOR training demo** — `make-network`, `train`, `predict`
- **Matrix arithmetic** — `mat-new`, `mat*`, `mat+`, `mat-scale`, `mat-transpose`
- **Linear algebra** — `mat-solve`, `mat-inv`, `mat-det`, `mat-eigen`, `mat-svd`
- **Evolution demos** — AST-level evolution with matrix-based fitness functions

The educational value is significant — users can explore neural networks and linear algebra directly in the browser.

---

## Estimated Effort

| Task | Duration |
|------|----------|
| Extract backend interface from matrix_primitives.cpp | 1 day |
| Implement Eigen backend (~12 functions) | 1 day |
| FetchContent integration + CMake wiring | 2 hours |
| Test in WASM (Node + browser) | 1 day |
| Verify MLP library loads and XOR trains | 2 hours |
| **Total** | **~3 days** |

---

## Risks

- **Eigen compile time** — Header-only template library, may add 30-60s to WASM build. Mitigated by only including what's needed (`<Eigen/Dense>`, not `<Eigen/Sparse>`).
- **Numerical precision** — Eigen and OpenBLAS may produce slightly different results for decompositions (different algorithms, different rounding). Acceptable for educational use; existing tests may need epsilon-widened tolerances.
- **Emscripten compatibility** — Eigen is widely used with Emscripten (TensorFlow Lite, OpenCV.js). No known blockers.
