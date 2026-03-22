/**
 * Emscripten module type declarations.
 * These will be refined once the WASM build exists.
 */

export interface EtilModule {
    /** Initialize the interpreter and load startup files */
    _etil_init(): void;

    /** Interpret a line of TIL code, returns output string pointer */
    _etil_interpret(linePtr: number): number;

    /** Get current stack state as JSON string pointer */
    _etil_get_stack(): number;

    /** Emscripten heap helpers */
    allocateUTF8(str: string): number;
    UTF8ToString(ptr: number): string;
    _free(ptr: number): void;
}

/**
 * Placeholder for the WASM module.
 * Before the real WASM build exists, we use a mock interpreter.
 */
export interface MockInterpreter {
    interpret(line: string): string;
    getStack(): string[];
}
