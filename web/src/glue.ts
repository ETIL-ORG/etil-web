/**
 * WASM <-> xterm.js bridge.
 *
 * Connects either the real WASM interpreter or a mock fallback
 * to the xterm.js terminal.
 */

import type { Terminal } from '@xterm/xterm';
import type { EtilInterpreter } from './types';

export class EtilGlue {
    private terminal: Terminal;
    private interpreter: EtilInterpreter;
    private lineBuffer: string = '';
    private prompt = '> ';
    private isWasm: boolean;

    constructor(terminal: Terminal, interpreter: EtilInterpreter, isWasm: boolean) {
        this.terminal = terminal;
        this.interpreter = interpreter;
        this.isWasm = isWasm;
    }

    /** Display banner and prompt */
    init(): void {
        const version = this.interpreter.getVersion();
        const mode = this.isWasm ? 'WASM' : 'mock';

        this.terminal.writeln(`\x1b[36mETIL v${version}\x1b[0m — Evolutionary Threaded Interpretive Language`);
        this.terminal.writeln(`\x1b[90mBrowser REPL (${mode} interpreter)\x1b[0m`);
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
                if (this.lineBuffer.length > 0) {
                    this.lineBuffer = this.lineBuffer.slice(0, -1);
                    this.terminal.write('\b \b');
                }
            } else if (ch === '\x03') {
                this.lineBuffer = '';
                this.terminal.writeln('^C');
                this.writePrompt();
            } else if (ch >= ' ') {
                this.lineBuffer += ch;
                this.terminal.write(ch);
            }
        }
    }

    private handleLine(line: string): void {
        const output = this.interpreter.interpret(line);
        if (output) {
            // Split output into lines and write each
            const lines = output.split('\n');
            for (const l of lines) {
                this.terminal.writeln(l);
            }
        }

        // Update status bar with stack
        const stack = this.interpreter.getStack();
        const statusEl = document.getElementById('status');
        if (statusEl) {
            statusEl.textContent = `Stack: ${stack}`;
            statusEl.className = 'status ready';
        }
    }

    private writePrompt(): void {
        this.terminal.write(this.prompt);
    }
}
