// Copyright (c) 2026 Mark Deazley / ETIL-ORG. All rights reserved.
// SPDX-License-Identifier: BSD-3-Clause
//
// ETIL WebAssembly entry point — exports C functions for the JavaScript glue layer

#include "etil/core/interpreter_bootstrap.hpp"
#include "etil/core/dictionary.hpp"
#include "etil/core/interpreter.hpp"
#include "etil/core/execution_context.hpp"
#include "etil/core/primitives.hpp"
#include "etil/core/version.hpp"
#include "etil/core/heap_string.hpp"
#include "etil/core/heap_byte_array.hpp"
#include "etil/core/heap_object.hpp"
#include "etil/lvfs/lvfs.hpp"

#include <filesystem>
#include <sstream>
#include <string>

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#endif

// Static interpreter state (single-threaded in WASM)
static std::unique_ptr<etil::core::InterpreterBundle> g_bundle;
static etil::lvfs::Lvfs* g_lvfs = nullptr;
static std::ostringstream g_out;
static std::ostringstream g_err;
static std::string g_result_buf;

// Write callback — JS registers a function pointer here.
using FsWriteCallback = void(*)();
static FsWriteCallback g_fs_write_callback = nullptr;

// Pending fetch request — http-get/http-post store args here,
// JS checks after each interpret call and completes the fetch.
struct PendingFetch {
    bool active = false;
    bool is_post = false;
    std::string url;
    std::string body;  // POST only
    // Headers are popped but not forwarded (browser fetch handles them)
};
static PendingFetch g_pending_fetch;

// http-get primitive: ( url headers-map -- ) saves args, JS completes async
static bool prim_wasm_http_get(etil::core::ExecutionContext& ctx) {
    // Pop headers map (consume and discard — browser fetch handles CORS headers)
    auto headers = ctx.data_stack().pop();
    if (!headers) return false;
    etil::core::value_release(*headers);

    // Pop URL string
    auto url_val = ctx.data_stack().pop();
    if (!url_val) return false;
    if (url_val->type != etil::core::Value::Type::String || !url_val->as_ptr) {
        ctx.err() << "Error: http-get expects a string URL\n";
        etil::core::value_release(*url_val);
        return false;
    }
    auto* hs = static_cast<etil::core::HeapString*>(url_val->as_ptr);
    g_pending_fetch.active = true;
    g_pending_fetch.is_post = false;
    g_pending_fetch.url = std::string(hs->view());
    g_pending_fetch.body.clear();
    etil::core::value_release(*url_val);
    return true;
}

// http-post primitive: ( url headers-map body-bytes -- ) saves args, JS completes async
static bool prim_wasm_http_post(etil::core::ExecutionContext& ctx) {
    // Pop body (byte array → string)
    auto body_val = ctx.data_stack().pop();
    if (!body_val) return false;
    std::string body_str;
    if (body_val->type == etil::core::Value::Type::ByteArray && body_val->as_ptr) {
        auto* ba = static_cast<etil::core::HeapByteArray*>(body_val->as_ptr);
        body_str.resize(ba->length());
        for (size_t i = 0; i < ba->length(); i++) {
            uint8_t b;
            ba->get(i, b);
            body_str[i] = static_cast<char>(b);
        }
    } else if (body_val->type == etil::core::Value::Type::String && body_val->as_ptr) {
        auto* hs = static_cast<etil::core::HeapString*>(body_val->as_ptr);
        body_str = std::string(hs->view());
    }
    etil::core::value_release(*body_val);

    // Pop headers map (consume and discard)
    auto headers = ctx.data_stack().pop();
    if (!headers) return false;
    etil::core::value_release(*headers);

    // Pop URL string
    auto url_val = ctx.data_stack().pop();
    if (!url_val) return false;
    if (url_val->type != etil::core::Value::Type::String || !url_val->as_ptr) {
        ctx.err() << "Error: http-post expects a string URL\n";
        etil::core::value_release(*url_val);
        return false;
    }
    auto* hs = static_cast<etil::core::HeapString*>(url_val->as_ptr);
    g_pending_fetch.active = true;
    g_pending_fetch.is_post = true;
    g_pending_fetch.url = std::string(hs->view());
    g_pending_fetch.body = std::move(body_str);
    etil::core::value_release(*url_val);
    return true;
}

extern "C" {

/// Initialize the interpreter and load startup files.
/// Call once before etil_interpret().
#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
void etil_init() {
    if (g_bundle) return;  // Already initialized

    // Unified bootstrap — same entry point as native REPL and MCP server
    g_bundle = etil::core::bootstrap_interpreter(
        etil::core::BootstrapMode::Wasm,
        g_out, g_err,
        {"/data/builtins.til", "/data/help.til"});

    // Register WASM-specific http-get/http-post that defer to JS fetch()
    using T = etil::core::TypeSignature::Type;
    g_bundle->dict->register_word("http-get",
        etil::core::make_primitive("http-get", prim_wasm_http_get,
            {T::Unknown, T::Unknown}, {}));
    g_bundle->dict->register_word("http-post",
        etil::core::make_primitive("http-post", prim_wasm_http_post,
            {T::Unknown, T::Unknown, T::Unknown}, {}));

    // Set up LVFS: /home → /home (Emscripten MEMFS/IDBFS), /library → /data/library
    std::error_code ec;
    std::filesystem::create_directories("/home", ec);
    std::filesystem::create_directories("/data/library", ec);

    g_lvfs = new etil::lvfs::Lvfs("/home/", "/data/library/");
    g_lvfs->set_write_callback([]() {
        if (g_fs_write_callback) g_fs_write_callback();
    });
    g_bundle->interp->set_lvfs(g_lvfs);
}

/// Interpret a line of TIL code.
/// Returns pointer to output string (valid until next call).
#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
const char* etil_interpret(const char* line) {
    if (!g_bundle) {
        g_result_buf = "Error: interpreter not initialized. Call etil_init() first.";
        return g_result_buf.c_str();
    }

    g_out.str("");
    g_out.clear();
    g_err.str("");
    g_err.clear();

    g_bundle->interp->interpret_line(line);

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
    if (!g_bundle) {
        g_result_buf = "(not initialized)";
        return g_result_buf.c_str();
    }

    g_result_buf = g_bundle->interp->stack_status();
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

/// Check if there's a pending fetch request.
/// Returns 1 if pending (GET), 2 if pending (POST), 0 if none.
#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
int etil_pending_fetch() {
    if (!g_pending_fetch.active) return 0;
    return g_pending_fetch.is_post ? 2 : 1;
}

/// Get the pending fetch URL. Valid until next etil_interpret() call.
#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
const char* etil_pending_fetch_url() {
    return g_pending_fetch.url.c_str();
}

/// Get the pending fetch POST body. Valid until next etil_interpret() call.
#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
const char* etil_pending_fetch_body() {
    return g_pending_fetch.body.c_str();
}

/// Push fetch result onto the TIL stack: ( body-string status flag )
/// Called by JS after fetch completes.
#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
void etil_push_fetch_result(const char* body, int status, int ok) {
    if (!g_bundle) return;

    // Push body as a HeapString
    auto* hs = etil::core::HeapString::create(body);
    g_bundle->interp->context().data_stack().push(etil::core::make_heap_value(hs));

    // Push status code
    g_bundle->interp->context().data_stack().push(etil::core::Value(static_cast<int64_t>(status)));

    // Push success flag
    g_bundle->interp->context().data_stack().push(etil::core::Value(ok != 0));

    g_pending_fetch.active = false;
}

/// Clear pending fetch without pushing results (on error).
#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
void etil_clear_pending_fetch() {
    g_pending_fetch.active = false;
}

} // extern "C"
