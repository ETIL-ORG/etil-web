// ETIL WebAssembly entry point
// Exports C functions for the JavaScript glue layer

#include "etil/core/dictionary.hpp"
#include "etil/core/interpreter.hpp"
#include "etil/core/execution_context.hpp"
#include "etil/core/primitives.hpp"
#include "etil/core/version.hpp"

#include <sstream>
#include <string>

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#endif

// Static interpreter state (single-threaded in WASM)
static etil::core::Dictionary* g_dict = nullptr;
static etil::core::Interpreter* g_interp = nullptr;
static std::ostringstream g_out;
static std::ostringstream g_err;
static std::string g_result_buf;

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

} // extern "C"
