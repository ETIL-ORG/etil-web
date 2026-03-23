// ETIL WebAssembly entry point
// Exports C functions for the JavaScript glue layer

#include "etil/core/dictionary.hpp"
#include "etil/core/interpreter.hpp"
#include "etil/core/execution_context.hpp"
#include "etil/core/primitives.hpp"
#include "etil/core/version.hpp"
#include "etil/lvfs/lvfs.hpp"

#include <filesystem>
#include <sstream>
#include <string>

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#endif

// Static interpreter state (single-threaded in WASM)
static etil::core::Dictionary* g_dict = nullptr;
static etil::core::Interpreter* g_interp = nullptr;
static etil::lvfs::Lvfs* g_lvfs = nullptr;
static std::ostringstream g_out;
static std::ostringstream g_err;
static std::string g_result_buf;

// Write callback — JS registers a function pointer here.
// Called by Lvfs after every write operation (write_file, mkdir, rm, etc.)
// JS uses this to trigger FS.syncfs() for IDBFS persistence.
using FsWriteCallback = void(*)();
static FsWriteCallback g_fs_write_callback = nullptr;

extern "C" {

/// Initialize the interpreter and load startup files.
/// Call once before etil_interpret().
#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
void etil_init() {
    if (g_dict) return;  // Already initialized

    g_dict = new etil::core::Dictionary();
    etil::core::register_primitives(*g_dict);

    g_interp = new etil::core::Interpreter(*g_dict, g_out, g_err);

    // Set up LVFS: /home → /home (Emscripten MEMFS/IDBFS), /library → /data/library
    // Create /home directory if it doesn't exist (first run)
    std::error_code ec;
    std::filesystem::create_directories("/home", ec);
    std::filesystem::create_directories("/data/library", ec);

    g_lvfs = new etil::lvfs::Lvfs("/home/", "/data/library/");
    g_lvfs->set_write_callback([]() {
        if (g_fs_write_callback) g_fs_write_callback();
    });
    g_interp->set_lvfs(g_lvfs);

    // Load startup files from Emscripten MEMFS
    // Failures are non-fatal — interpreter works without them
    try {
        if (!g_interp->load_file("/data/builtins.til")) {
            g_err << "Warning: failed to load builtins.til\n";
        }
    } catch (...) {
        g_err << "Warning: exception loading builtins.til\n";
    }

    try {
        if (!g_interp->load_file("/data/help.til")) {
            g_err << "Warning: failed to load help.til\n";
        }
    } catch (...) {
        g_err << "Warning: exception loading help.til\n";
    }
}

/// Interpret a line of TIL code.
/// Returns pointer to output string (valid until next call).
#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
const char* etil_interpret(const char* line) {
    if (!g_interp) {
        g_result_buf = "Error: interpreter not initialized. Call etil_init() first.";
        return g_result_buf.c_str();
    }

    g_out.str("");
    g_out.clear();
    g_err.str("");
    g_err.clear();

    g_interp->interpret_line(line);

    // Combine output and errors
    std::string out = g_out.str();
    std::string err = g_err.str();

    if (!err.empty()) {
        if (!out.empty()) out += "\n";
        out += err;
    }

    g_result_buf = std::move(out);
    return g_result_buf.c_str();
}

/// Get current stack state as a string.
/// Returns pointer to string (valid until next call).
#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
const char* etil_get_stack() {
    if (!g_interp) {
        g_result_buf = "(not initialized)";
        return g_result_buf.c_str();
    }

    g_result_buf = g_interp->stack_status();
    return g_result_buf.c_str();
}

/// Get the ETIL version string.
#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
const char* etil_version() {
    g_result_buf = std::string(etil::core::ETIL_VERSION);
    return g_result_buf.c_str();
}

/// Register a callback invoked after every LVFS write operation.
/// JS calls this once at startup to wire FS.syncfs().
#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
void etil_set_fs_write_callback(FsWriteCallback cb) {
    g_fs_write_callback = cb;
}

/// Write a file to the LVFS /home directory.
/// Returns 1 on success, 0 on failure.
#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
int etil_write_file(const char* path, const char* content) {
    if (!g_lvfs) return 0;
    return g_lvfs->write_file(path, content) ? 1 : 0;
}

/// Read a file from the LVFS.
/// Returns pointer to content string (valid until next call), or empty string on failure.
#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
const char* etil_read_file(const char* path) {
    if (!g_lvfs) {
        g_result_buf.clear();
        return g_result_buf.c_str();
    }
    auto content = g_lvfs->read_file(path);
    g_result_buf = content.value_or("");
    return g_result_buf.c_str();
}

/// Check if a path exists in the LVFS.
#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
int etil_exists(const char* path) {
    if (!g_lvfs) return 0;
    return g_lvfs->exists(path) ? 1 : 0;
}

/// Create a directory in the LVFS /home directory.
#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
int etil_mkdir(const char* path) {
    if (!g_lvfs) return 0;
    return g_lvfs->make_dir(path) ? 1 : 0;
}

/// Remove a file from the LVFS /home directory.
#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
int etil_rm(const char* path) {
    if (!g_lvfs) return 0;
    return g_lvfs->remove_file(path) ? 1 : 0;
}

} // extern "C"
