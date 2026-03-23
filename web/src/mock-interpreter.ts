// Copyright (c) 2026 Mark Deazley / ETIL-ORG. All rights reserved.
// SPDX-License-Identifier: BSD-3-Clause
/**
 * Mock interpreter for frontend development without WASM.
 */

import type { EtilInterpreter } from './types';

export class MockInterpreter implements EtilInterpreter {
    private stack: string[] = [];

    interpret(line: string): string {
        const trimmed = line.trim();
        if (!trimmed) return '';

        if (trimmed === 'help') {
            return 'ETIL WASM REPL (mock interpreter)\n' +
                   'The real interpreter loads when etil.js + etil.wasm are present.\n' +
                   'This mock responds to: help, words, .s, <number>';
        }
        if (trimmed === 'words') {
            return '[mock] No words loaded — run `pnpm build:wasm` first';
        }
        if (trimmed === '.s') {
            if (this.stack.length === 0) return '(0)';
            return `(${this.stack.length}) ${this.stack.join(' ')}`;
        }

        const num = Number(trimmed);
        if (!isNaN(num) && trimmed !== '') {
            this.stack.push(trimmed);
            return '';
        }

        return `[mock] Unknown word: ${trimmed}`;
    }

    getStack(): string {
        if (this.stack.length === 0) return '(0)';
        return `(${this.stack.length}) ${this.stack.join(' ')}`;
    }

    getVersion(): string {
        return 'mock';
    }
}
