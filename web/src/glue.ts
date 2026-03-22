/**
 * WASM <-> xterm.js bridge.
 *
 * Before the real WASM module exists, this provides a mock interpreter
 * that echoes input and responds to basic commands so the frontend
 * can be developed and tested independently.
 */

import type { Terminal } from '@xterm/xterm';
import type { MockInterpreter } from './types';

/** Create a mock interpreter for frontend development */
function createMockInterpreter(): MockInterpreter {
    const stack: string[] = [];

    return {
        interpret(line: string): string {
            const trimmed = line.trim();
            if (!trimmed) return '';

            // Simulate a few basic operations for UI testing
            if (trimmed === 'help') {
                return 'ETIL WASM REPL (mock interpreter)\n' +
                       'The real interpreter will be available after Stage 1.\n' +
                       'This mock responds to: help, words, .s, <number>';
            }
            if (trimmed === 'words') {
                return '[mock] No words loaded — WASM module not yet built';
            }
            if (trimmed === '.s') {
                if (stack.length === 0) return '(0)';
                return `(${stack.length}) ${stack.join(' ')}`;
            }

            // Try to parse as number
            const num = Number(trimmed);
            if (!isNaN(num) && trimmed !== '') {
                stack.push(trimmed);
                return '';
            }

            return `[mock] Unknown word: ${trimmed}`;
        },

        getStack(): string[] {
            return [...stack];
        }
    };
}

export class EtilGlue {
    private terminal: Terminal;
    private interpreter: MockInterpreter;
    private lineBuffer: string = '';
    private prompt = '> ';

    constructor(terminal: Terminal) {
        this.terminal = terminal;
        this.interpreter = createMockInterpreter();
    }

    /** Initialize the glue layer and display banner */
    init(): void {
        this.terminal.writeln('\x1b[36mETIL v1.6.0\x1b[0m — Evolutionary Threaded Interpretive Language');
        this.terminal.writeln('\x1b[90mBrowser REPL (mock interpreter — WASM build pending)\x1b[0m');
        this.terminal.writeln('');
        this.writePrompt();
    }

    /** Handle a single character of input from xterm.js */
    onData(data: string): void {
        for (const ch of data) {
            if (ch === '\r' || ch === '\n') {
                this.terminal.writeln('');
                this.handleLine(this.lineBuffer);
                this.lineBuffer = '';
                this.writePrompt();
            } else if (ch === '\x7f' || ch === '\b') {
                // Backspace
                if (this.lineBuffer.length > 0) {
                    this.lineBuffer = this.lineBuffer.slice(0, -1);
                    this.terminal.write('\b \b');
                }
            } else if (ch === '\x03') {
                // Ctrl+C — clear line
                this.lineBuffer = '';
                this.terminal.writeln('^C');
                this.writePrompt();
            } else if (ch >= ' ') {
                // Printable character
                this.lineBuffer += ch;
                this.terminal.write(ch);
            }
        }
    }

    private handleLine(line: string): void {
        const output = this.interpreter.interpret(line);
        if (output) {
            this.terminal.writeln(output);
        }
        // Show stack depth in status bar
        const stack = this.interpreter.getStack();
        const statusEl = document.getElementById('status');
        if (statusEl) {
            statusEl.textContent = `Stack: (${stack.length})`;
            statusEl.className = 'status ready';
        }
    }

    private writePrompt(): void {
        this.terminal.write(this.prompt);
    }
}
