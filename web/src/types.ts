/**
 * Emscripten module type declarations.
 */

/** The Emscripten module returned by createEtilModule() */
export interface EtilModule {
    _etil_init(): void;
    _etil_interpret(linePtr: number): number;
    _etil_get_stack(): number;
    _etil_version(): number;
    _etil_set_fs_write_callback(cbPtr: number): void;
    _etil_write_file(pathPtr: number, contentPtr: number): number;
    _etil_read_file(pathPtr: number): number;
    _etil_exists(pathPtr: number): number;
    _etil_mkdir(pathPtr: number): number;
    _etil_rm(pathPtr: number): number;
    _free(ptr: number): void;
    _malloc(size: number): number;

    allocateUTF8(str: string): number;
    UTF8ToString(ptr: number): string;
    ccall(name: string, returnType: string, argTypes: string[], args: unknown[]): unknown;
    cwrap(name: string, returnType: string, argTypes: string[]): (...args: unknown[]) => unknown;
    addFunction(fn: (...args: unknown[]) => unknown, sig: string): number;

    // Emscripten FS API
    FS: EmscriptenFS;
}

/** Emscripten virtual filesystem API */
export interface EmscriptenFS {
    mkdir(path: string): void;
    mount(type: unknown, opts: Record<string, unknown>, mountpoint: string): void;
    syncfs(populate: boolean, callback: (err: unknown) => void): void;
    readdir(path: string): string[];
    readFile(path: string, opts?: { encoding?: string }): string | Uint8Array;
    writeFile(path: string, data: string | Uint8Array): void;
    stat(path: string): { size: number; mtime: Date; mode: number };
    isDir(mode: number): boolean;
    unlink(path: string): void;
    rmdir(path: string): void;
    analyzePath(path: string): { exists: boolean };
}

/** Factory function exported by Emscripten's MODULARIZE */
export type EtilModuleFactory = (overrides?: Partial<EtilModule>) => Promise<EtilModule>;

/** Interpreter interface — implemented by both WASM and mock */
export interface EtilInterpreter {
    interpret(line: string): string;
    getStack(): string;
    getVersion(): string;
}
