/**
 * WASM interpreter — wraps the Emscripten module.
 * Handles IDBFS mount and fs-write sync callback.
 */

import type { EtilModule, EtilModuleFactory, EtilInterpreter } from './types';

export class WasmInterpreter implements EtilInterpreter {
    private module: EtilModule;

    constructor(module: EtilModule) {
        this.module = module;
    }

    interpret(line: string): string {
        const linePtr = this.module.allocateUTF8(line);
        const outPtr = this.module._etil_interpret(linePtr);
        const result = this.module.UTF8ToString(outPtr);
        this.module._free(linePtr);
        return result;
    }

    getStack(): string {
        const ptr = this.module._etil_get_stack();
        return this.module.UTF8ToString(ptr);
    }

    getVersion(): string {
        const ptr = this.module._etil_version();
        return this.module.UTF8ToString(ptr);
    }

    /** Write a file to LVFS /home via C++ */
    writeFile(path: string, content: string): boolean {
        const pathPtr = this.module.allocateUTF8(path);
        const contentPtr = this.module.allocateUTF8(content);
        const ok = this.module._etil_write_file(pathPtr, contentPtr) === 1;
        this.module._free(pathPtr);
        this.module._free(contentPtr);
        return ok;
    }

    /** Read a file from LVFS */
    readFile(path: string): string | null {
        const pathPtr = this.module.allocateUTF8(path);
        const resultPtr = this.module._etil_read_file(pathPtr);
        const content = this.module.UTF8ToString(resultPtr);
        this.module._free(pathPtr);
        return content || null;
    }

    /** Check if path exists in LVFS */
    exists(path: string): boolean {
        const pathPtr = this.module.allocateUTF8(path);
        const result = this.module._etil_exists(pathPtr) === 1;
        this.module._free(pathPtr);
        return result;
    }

    /** List files in a directory via Emscripten FS */
    listDir(path: string): string[] {
        try {
            return this.module.FS.readdir(path).filter(
                (f: string) => f !== '.' && f !== '..'
            );
        } catch {
            return [];
        }
    }

    /** Access the raw Emscripten FS for export/import */
    get fs(): EtilModule['FS'] {
        return this.module.FS;
    }

    /** Access the raw module for addFunction */
    get raw(): EtilModule {
        return this.module;
    }
}

/**
 * Mount IDBFS at /home for persistent storage.
 * Populates MEMFS from IndexedDB on first load.
 */
async function mountIDBFS(module: EtilModule): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
        try {
            // Emscripten exposes IDBFS via FS.filesystems
            const fsModule = module.FS as unknown as Record<string, unknown>;
            const filesystems = fsModule.filesystems as Record<string, unknown> | undefined;
            const IDBFS = filesystems?.IDBFS;
            if (!IDBFS) {
                console.warn('IDBFS not available — files will not persist');
                resolve(false);
                return;
            }

            // /home is created by etil_init() via std::filesystem::create_directories
            // but IDBFS must be mounted before init so it persists.
            // Create /home if it doesn't exist, then mount IDBFS on it.
            try { module.FS.mkdir('/home'); } catch { /* already exists */ }

            module.FS.mount(IDBFS, {}, '/home');

            // Populate MEMFS from IndexedDB (true = populate from persistent)
            module.FS.syncfs(true, (err: unknown) => {
                if (err) {
                    console.warn('IDBFS sync failed:', err);
                    resolve(false);
                } else {
                    resolve(true);
                }
            });
        } catch (err) {
            console.warn('IDBFS mount failed:', err);
            resolve(false);
        }
    });
}

/**
 * Register the fs-write callback that syncs MEMFS → IndexedDB.
 */
function registerSyncCallback(module: EtilModule): void {
    let syncPending = false;

    const syncToIDB = () => {
        if (syncPending) return;
        syncPending = true;

        // Debounce: sync after 100ms to batch rapid writes
        setTimeout(() => {
            syncPending = false;
            module.FS.syncfs(false, (err: unknown) => {
                if (err) console.warn('IDBFS sync error:', err);
            });
        }, 100);
    };

    // Register as C function pointer via addFunction
    const cbPtr = module.addFunction(syncToIDB, 'v');
    module._etil_set_fs_write_callback(cbPtr as number);

    // Also sync on page unload
    window.addEventListener('beforeunload', () => {
        module.FS.syncfs(false, () => {});
    });
}

/**
 * Seed /home with example files on first launch.
 */
function seedExampleFiles(module: EtilModule): void {
    // Check if /home is empty (first launch)
    let files: string[];
    try {
        files = module.FS.readdir('/home').filter(
            (f: string) => f !== '.' && f !== '..'
        );
    } catch {
        return; // /home doesn't exist yet
    }
    if (files.length > 0) return; // Already has files

    const examples: Record<string, string> = {
        'hello.til': ': hello ." Hello from ETIL!" cr ;\nhello\n',
        'fibonacci.til': [
            '# Fibonacci sequence',
            ': fib ( n -- fib )',
            '  dup 1 > if',
            '    dup 1 - recurse',
            '    swap 2 - recurse +',
            '  then ;',
            '',
            '# Print first 10 Fibonacci numbers',
            '10 0 do i fib . space loop cr',
            '',
        ].join('\n'),
        'factorial.til': [
            '# Factorial',
            ': fact ( n -- n! )',
            '  dup 1 > if',
            '    dup 1 - recurse *',
            '  then ;',
            '',
            '10 fact . cr  # 3628800',
            '',
        ].join('\n'),
        'observable-demo.til': [
            '# Observable pipeline demo',
            '0 20 obs-range',
            '  \' dup * obs-map       # square each number',
            '  \' 100 < obs-filter    # keep only < 100',
            '  obs-to-array           # collect results',
            '',
            '# Print the array',
            'dup array-length . ." items: " cr',
            'dup array-length 0 do dup i array-get . space loop drop cr',
            '',
        ].join('\n'),
    };

    for (const [name, content] of Object.entries(examples)) {
        try {
            module.FS.writeFile(`/home/${name}`, content);
        } catch (err) {
            console.warn(`Failed to write example ${name}:`, err);
        }
    }
}

/**
 * Try to load the WASM module. Returns null if not available.
 */
export async function loadWasmInterpreter(
    onStdout?: (text: string) => void,
    onStderr?: (text: string) => void,
): Promise<WasmInterpreter | null> {
    try {
        const factory = (globalThis as unknown as Record<string, EtilModuleFactory>).createEtilModule;
        if (!factory) {
            console.warn('createEtilModule not found — WASM module not loaded');
            return null;
        }

        const module = await factory({
            print: onStdout ?? console.log,
            printErr: onStderr ?? console.error,
        } as Partial<EtilModule>);

        // Mount IDBFS at /home before init (persists user files)
        const idbfsOk = await mountIDBFS(module);

        // Initialize interpreter (loads builtins.til + help.til, creates /home)
        module._etil_init();

        // Seed example files on first launch (after init created /home)
        seedExampleFiles(module);

        // Register sync callback (only if IDBFS mounted)
        if (idbfsOk) {
            registerSyncCallback(module);
        }

        return new WasmInterpreter(module);
    } catch (err) {
        console.error('Failed to load WASM module:', err);
        return null;
    }
}
