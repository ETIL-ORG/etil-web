/**
 * Emscripten module type declarations.
 */

/** The Emscripten module returned by createEtilModule() */
export interface EtilModule {
    _etil_init(): void;
    _etil_interpret(linePtr: number): number;
    _etil_get_stack(): number;
    _etil_version(): number;
    _free(ptr: number): void;

    allocateUTF8(str: string): number;
    UTF8ToString(ptr: number): string;
    ccall(name: string, returnType: string, argTypes: string[], args: unknown[]): unknown;
    cwrap(name: string, returnType: string, argTypes: string[]): (...args: unknown[]) => unknown;
}

/** Factory function exported by Emscripten's MODULARIZE */
export type EtilModuleFactory = (overrides?: Partial<EtilModule>) => Promise<EtilModule>;

/** Interpreter interface — implemented by both WASM and mock */
export interface EtilInterpreter {
    interpret(line: string): string;
    getStack(): string;
    getVersion(): string;
}
