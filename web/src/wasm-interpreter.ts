/**
 * WASM interpreter — wraps the Emscripten module.
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
}

/**
 * Try to load the WASM module. Returns null if not available.
 */
export async function loadWasmInterpreter(
    onStdout?: (text: string) => void,
    onStderr?: (text: string) => void,
): Promise<WasmInterpreter | null> {
    try {
        // Emscripten's MODULARIZE puts the factory on globalThis
        const factory = (globalThis as unknown as Record<string, EtilModuleFactory>).createEtilModule;
        if (!factory) {
            console.warn('createEtilModule not found — WASM module not loaded');
            return null;
        }

        const module = await factory({
            print: onStdout ?? console.log,
            printErr: onStderr ?? console.error,
        } as Partial<EtilModule>);

        module._etil_init();

        return new WasmInterpreter(module);
    } catch (err) {
        console.error('Failed to load WASM module:', err);
        return null;
    }
}
