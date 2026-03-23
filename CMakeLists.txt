cmake_minimum_required(VERSION 3.20)
project(EtilWeb VERSION 0.1.0 LANGUAGES C CXX)

# Force WASM target options before including ETIL source tree
set(ETIL_WASM_TARGET ON CACHE BOOL "" FORCE)
set(ETIL_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(ETIL_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(ETIL_BUILD_HTTP_CLIENT OFF CACHE BOOL "" FORCE)
set(ETIL_BUILD_JWT OFF CACHE BOOL "" FORCE)
set(ETIL_BUILD_MONGODB OFF CACHE BOOL "" FORCE)

# Enable WASM exceptions for the entire build
if(EMSCRIPTEN)
    add_compile_options(-fwasm-exceptions)
endif()

# Include the ETIL source tree (via symlink etil-src -> evolutionary-til)
add_subdirectory(etil-src)

# WASM entry point executable
add_executable(etil_wasm wasm/etil_wasm.cpp)
target_link_libraries(etil_wasm PRIVATE etil)

# Emscripten link flags
if(EMSCRIPTEN)
    set_target_properties(etil_wasm PROPERTIES
        OUTPUT_NAME "etil"
        SUFFIX ".js"
    )
    target_link_options(etil_wasm PRIVATE
        "SHELL:-s WASM=1"
        "SHELL:-s ALLOW_MEMORY_GROWTH=1"
        "SHELL:-s INITIAL_MEMORY=268435456"
        "SHELL:-s EXPORTED_FUNCTIONS=['_etil_init','_etil_interpret','_etil_get_stack','_etil_version','_etil_set_fs_write_callback','_etil_write_file','_etil_read_file','_etil_exists','_etil_mkdir','_etil_rm','_free','_malloc']"
        "SHELL:-s EXPORTED_RUNTIME_METHODS=['UTF8ToString','allocateUTF8','ccall','cwrap','addFunction']"
        "SHELL:-s ALLOW_TABLE_GROWTH=1"
        "SHELL:-s MODULARIZE=1"
        "SHELL:-s EXPORT_NAME='createEtilModule'"
        "SHELL:-s ENVIRONMENT='web,node'"
        "SHELL:-s NO_EXIT_RUNTIME=1"
        "SHELL:-s TEXTDECODER=2"
        "SHELL:-fwasm-exceptions"
        "SHELL:--embed-file ${CMAKE_CURRENT_SOURCE_DIR}/etil-src/data@/data"
    )
endif()
