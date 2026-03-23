# WASM File I/O — Enable 13 File Words via stdlib Fallback

**Date:** 2026-03-23
**References:** `20260323-Eigen-Matrix-Backend.md` (same pattern: dual backend via compile gates)
**Prerequisites:** Stage 7 complete. WASM build functional with matrix words.
**Status:** Planned

---

## Problem

The 13 file I/O words (`exists?`, `read-file`, `write-file`, `append-file`, `copy-file`, `rename-file`, `lstat`, `readdir`, `mkdir`, `mkdir-tmp`, `rmdir`, `rm`, `truncate`) are excluded from the WASM build because `async_file_io.cpp` includes `<uv.h>` (libuv) which is unavailable in Emscripten.

However, **every word already has a `std::filesystem`/`fstream` fallback** that runs when `ctx.uv_session()` returns nullptr. In WASM there is no `UvSession`, so the fallback is the only code path that would ever execute. The libuv code is dead code in WASM — it just can't compile.

## Solution: Option A — `#ifndef ETIL_WASM_BUILD` Gates

Gate the libuv includes and async code paths with `#ifndef ETIL_WASM_BUILD`. The stdlib fallback code compiles unconditionally. No behavioral changes, no new files, no code duplication.

**Execution is synchronous in WASM.** If someone loads a huge file, the browser tab blocks. That's acceptable — same as any other blocking TIL word.

---

## Files to Modify

### 1. `src/fileio/file_io_helpers.hpp`

**Problem:** `#include <uv.h>` at line 17 and `make_stat_array(const uv_stat_t&, bool)` at line 267 use libuv types.

**Fix:**
```cpp
#ifndef ETIL_WASM_BUILD
#include <uv.h>
#endif
```

Gate `make_stat_array()` with `#ifndef ETIL_WASM_BUILD` — it is only called from the libuv path of `lstat`. The stdlib fallback in `lstat` builds the array manually via `fs::status()`.

### 2. `src/fileio/async_file_io.cpp`

**Problem:** `#include <uv.h>` and `#include "etil/fileio/uv_session.hpp"` at lines 5 and 24. Every word function has a libuv code path after the `if (!uv)` fallback that references `FsRequest`, `uv_fs_*` calls, `uv_buf_t`, etc.

**Fix:** Gate the two includes:
```cpp
#ifndef ETIL_WASM_BUILD
#include "etil/fileio/uv_session.hpp"
#include <uv.h>
#endif
```

In each of the 10 word functions that have libuv paths (all except `mkdir` and `rm` which are already pure stdlib), gate the libuv block:

```cpp
bool prim_exists(ExecutionContext& ctx) {
    // ... resolve path ...

#ifndef ETIL_WASM_BUILD
    auto* uv = ctx.uv_session();
    if (!uv) {
#endif
        // Fallback — always runs in WASM, runs when no UvSession natively
        std::error_code ec;
        bool exists = fs::exists(fs_path, ec);
        ctx.data_stack().push(Value(static_cast<bool>(exists)));
        return true;
#ifndef ETIL_WASM_BUILD
    }

    FsRequest req;
    uv_fs_stat(uv->loop(), &req.req, fs_path.c_str(), FsRequest::on_complete);
    // ... rest of libuv path ...
#endif
}
```

The 10 functions requiring this pattern:
1. `prim_exists` (line 45)
2. `prim_read_file` (line 74)
3. `prim_write_file_impl` (line 180) — shared by `write-file` and `append-file`
4. `prim_copy_file` (line 263)
5. `prim_rename_file` (line 294)
6. `prim_lstat` (line 322)
7. `prim_readdir` (line 377)
8. `prim_mkdtemp` (line 449) — uses `mkdtemp()` POSIX fallback
9. `prim_rmdir` (line 518)
10. `prim_truncate` (line 583)

`prim_mkdir` (line 430) and `prim_rm` (line 559) already use only `std::filesystem` — no changes needed.

### 3. `src/CMakeLists.txt`

**Current:** File I/O sources are gated by `if(NOT ETIL_WASM_TARGET)`:
```cmake
if(NOT ETIL_WASM_TARGET)
    list(APPEND ETIL_CORE_SOURCES
        fileio/file_io_primitives.cpp
        fileio/uv_session.cpp
        fileio/async_file_io.cpp
    )
endif()
```

**Fix:** Move `file_io_primitives.cpp` and `async_file_io.cpp` to always compile. Keep `uv_session.cpp` native-only (it's the libuv event loop wrapper):
```cmake
# File I/O primitives — always compiled (stdlib fallback in WASM)
list(APPEND ETIL_CORE_SOURCES
    fileio/file_io_primitives.cpp
    fileio/async_file_io.cpp
)

# UvSession (libuv event loop) — native only
if(NOT ETIL_WASM_TARGET)
    list(APPEND ETIL_CORE_SOURCES
        fileio/uv_session.cpp
    )
endif()
```

### 4. `src/core/primitives.cpp`

**Current:** Registration calls gated by `#ifndef ETIL_WASM_BUILD`:
```cpp
#ifndef ETIL_WASM_BUILD
    etil::fileio::register_file_io_primitives(dict);
    etil::fileio::register_async_file_io_primitives(dict);
#endif
```

**Fix:** Remove the guard:
```cpp
    etil::fileio::register_file_io_primitives(dict);
    etil::fileio::register_async_file_io_primitives(dict);
```

Also remove the `#ifndef ETIL_WASM_BUILD` around the includes at the top of the file:
```cpp
// Currently gated:
#ifndef ETIL_WASM_BUILD
#include "etil/fileio/async_file_io.hpp"
#include "etil/fileio/file_io_primitives.hpp"
#endif

// Change to unconditional:
#include "etil/fileio/async_file_io.hpp"
#include "etil/fileio/file_io_primitives.hpp"
```

---

## Files Unchanged

| File | Notes |
|------|-------|
| `include/etil/fileio/async_file_io.hpp` | Just a forward declaration + registration function — no libuv types |
| `include/etil/fileio/file_io_primitives.hpp` | Just a forward declaration — no libuv types |
| `include/etil/fileio/uv_session.hpp` | Not included in WASM build (gated in async_file_io.cpp) |
| `src/fileio/uv_session.cpp` | Not compiled in WASM build (gated in CMakeLists.txt) |
| `src/fileio/file_io_primitives.cpp` | Empty registration — no-op, no libuv dependency |
| `etil-web/CMakeLists.txt` | No changes needed — inherits from ETIL's src/CMakeLists.txt |
| `etil-web/wasm/etil_wasm.cpp` | No changes needed — words register via `register_primitives()` |

---

## Verification

### Native Build
- [ ] Debug + release build clean (zero warnings)
- [ ] 1361/1361 tests pass — no regressions from `#ifndef` gates

### WASM Build
- [ ] Clean WASM rebuild
- [ ] Node.js test — all 13 file I/O words:
  ```
  s" hello" s" /home/test.txt" write-file   # write
  s" /home/test.txt" read-file drop .        # read back
  s" /home/test.txt" exists?                 # exists check
  s" world" s" /home/test.txt" append-file   # append
  s" /home/test.txt" lstat drop              # stat
  s" /home" readdir drop                     # directory listing
  s" /home/subdir" mkdir                     # create directory
  s" /home/test.txt" s" /home/test2.txt" copy-file    # copy
  s" /home/test2.txt" s" /home/test3.txt" rename-file # rename
  s" /home/test3.txt" truncate               # truncate
  s" /home/test3.txt" rm                     # remove file
  s" /home/subdir" rmdir                     # remove directory
  ```
- [ ] `words` output includes all 13 file I/O words
- [ ] Browser test — write a file, F5 reload, read it back (IDBFS persistence)

### Binary Size
- [ ] Measure WASM binary size impact (expected: < 20 KB increase — stdlib file ops are tiny)

---

## Estimated Effort

| Task | Solo Human | AI-Assisted |
|------|-----------|-------------|
| Gate helpers + async_file_io.cpp | 3 hours | 20 min |
| CMake + primitives.cpp changes | 30 min | 5 min |
| Native build + test | 30 min | 5 min |
| WASM build + Node test | 1 hour | 15 min |
| Browser test | 30 min | 10 min |
| **Total** | **~6 hours** | **~1 hour** |
