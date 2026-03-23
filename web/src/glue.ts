/**
 * WASM <-> xterm.js bridge.
 *
 * Handles line editing, command history, meta-commands,
 * and routes TIL code to the interpreter.
 */

import type { Terminal } from '@xterm/xterm';
import type { EtilInterpreter } from './types';

// Injected by esbuild --define:BUILD_TIME at build time
declare const BUILD_TIME: string;

const MAX_HISTORY = 100;

const HELP_TEXT = `\x1b[36mETIL Browser REPL — Commands\x1b[0m

  \x1b[33m/help\x1b[0m          Show this help
  \x1b[33m/words\x1b[0m         List all dictionary words
  \x1b[33m/clear\x1b[0m         Clear the terminal
  \x1b[33m/stack\x1b[0m         Show the data stack
  \x1b[33m/version\x1b[0m       Show ETIL version

  Type any TIL code at the prompt.
  Example: \x1b[32m42 dup + .\x1b[0m`;

export class EtilGlue {
    private terminal: Terminal;
    private interpreter: EtilInterpreter;
    private lineBuffer: string = '';
    private cursorPos: number = 0;
    private prompt = '> ';
    private isWasm: boolean;
    private history: string[] = [];
    private historyIndex: number = -1;
    private savedLine: string = '';

    constructor(terminal: Terminal, interpreter: EtilInterpreter, isWasm: boolean) {
        this.terminal = terminal;
        this.interpreter = interpreter;
        this.isWasm = isWasm;
    }

    /** Display banner and prompt */
    init(): void {
        const version = this.interpreter.getVersion();
        const mode = this.isWasm ? 'WASM' : 'mock';
        const buildTime = BUILD_TIME;

        this.terminal.writeln(`\x1b[36mETIL v${version}\x1b[0m — Evolutionary Threaded Interpretive Language`);
        this.terminal.writeln(`\x1b[90mBrowser REPL (${mode} interpreter) — type /help for commands\x1b[0m`);
        this.terminal.writeln(`\x1b[90mBuild: ${buildTime}\x1b[0m`);
        this.terminal.writeln('');
        this.writePrompt();
    }

    /** Handle input data from xterm.js */
    onData(data: string): void {
        // Escape sequences (arrow keys, etc.)
        if (data.startsWith('\x1b[')) {
            this.handleEscapeSequence(data);
            return;
        }
        // Other escape sequences we don't handle — ignore
        if (data.startsWith('\x1b')) {
            return;
        }

        for (const ch of data) {
            if (ch === '\r' || ch === '\n') {
                this.terminal.writeln('');
                if (this.lineBuffer.trim()) {
                    this.addToHistory(this.lineBuffer);
                }
                this.handleLine(this.lineBuffer);
                this.lineBuffer = '';
                this.cursorPos = 0;
                this.historyIndex = -1;
                this.writePrompt();
            } else if (ch === '\x7f' || ch === '\b') {
                this.handleBackspace();
            } else if (ch === '\x03') {
                // Ctrl+C
                this.lineBuffer = '';
                this.cursorPos = 0;
                this.terminal.writeln('^C');
                this.writePrompt();
            } else if (ch === '\x01') {
                // Ctrl+A — move to start
                this.moveCursorTo(0);
            } else if (ch === '\x05') {
                // Ctrl+E — move to end
                this.moveCursorTo(this.lineBuffer.length);
            } else if (ch === '\x0b') {
                // Ctrl+K — kill to end of line
                const deleted = this.lineBuffer.length - this.cursorPos;
                this.lineBuffer = this.lineBuffer.substring(0, this.cursorPos);
                // Clear from cursor to end of line
                this.terminal.write('\x1b[K');
            } else if (ch === '\x15') {
                // Ctrl+U — kill entire line
                this.clearLine();
                this.lineBuffer = '';
                this.cursorPos = 0;
            } else if (ch >= ' ') {
                this.insertChar(ch);
            }
        }
    }

    private handleEscapeSequence(seq: string): void {
        switch (seq) {
            case '\x1b[A': // Up arrow
                this.historyUp();
                break;
            case '\x1b[B': // Down arrow
                this.historyDown();
                break;
            case '\x1b[C': // Right arrow
                if (this.cursorPos < this.lineBuffer.length) {
                    this.cursorPos++;
                    this.terminal.write('\x1b[C');
                }
                break;
            case '\x1b[D': // Left arrow
                if (this.cursorPos > 0) {
                    this.cursorPos--;
                    this.terminal.write('\x1b[D');
                }
                break;
            case '\x1b[H': // Home
                this.moveCursorTo(0);
                break;
            case '\x1b[F': // End
                this.moveCursorTo(this.lineBuffer.length);
                break;
            case '\x1b[3~': // Delete
                this.handleDelete();
                break;
        }
    }

    private insertChar(ch: string): void {
        if (this.cursorPos === this.lineBuffer.length) {
            // Append at end
            this.lineBuffer += ch;
            this.cursorPos++;
            this.terminal.write(ch);
        } else {
            // Insert in middle
            this.lineBuffer =
                this.lineBuffer.substring(0, this.cursorPos) +
                ch +
                this.lineBuffer.substring(this.cursorPos);
            this.cursorPos++;
            // Rewrite from cursor position
            this.terminal.write(
                ch +
                this.lineBuffer.substring(this.cursorPos) +
                '\x1b[' + (this.lineBuffer.length - this.cursorPos) + 'D'
            );
        }
    }

    private handleBackspace(): void {
        if (this.cursorPos <= 0) return;

        if (this.cursorPos === this.lineBuffer.length) {
            // Simple backspace at end
            this.lineBuffer = this.lineBuffer.slice(0, -1);
            this.cursorPos--;
            this.terminal.write('\b \b');
        } else {
            // Backspace in middle
            this.lineBuffer =
                this.lineBuffer.substring(0, this.cursorPos - 1) +
                this.lineBuffer.substring(this.cursorPos);
            this.cursorPos--;
            // Move back, rewrite rest, clear last char, move back
            const rest = this.lineBuffer.substring(this.cursorPos);
            this.terminal.write(
                '\b' + rest + ' ' +
                '\x1b[' + (rest.length + 1) + 'D'
            );
        }
    }

    private handleDelete(): void {
        if (this.cursorPos >= this.lineBuffer.length) return;

        this.lineBuffer =
            this.lineBuffer.substring(0, this.cursorPos) +
            this.lineBuffer.substring(this.cursorPos + 1);
        const rest = this.lineBuffer.substring(this.cursorPos);
        this.terminal.write(rest + ' ' + '\x1b[' + (rest.length + 1) + 'D');
    }

    private moveCursorTo(pos: number): void {
        if (pos < 0) pos = 0;
        if (pos > this.lineBuffer.length) pos = this.lineBuffer.length;
        const delta = pos - this.cursorPos;
        if (delta > 0) {
            this.terminal.write('\x1b[' + delta + 'C');
        } else if (delta < 0) {
            this.terminal.write('\x1b[' + (-delta) + 'D');
        }
        this.cursorPos = pos;
    }

    private clearLine(): void {
        // Move to start of input, clear to end
        if (this.cursorPos > 0) {
            this.terminal.write('\x1b[' + this.cursorPos + 'D');
        }
        this.terminal.write('\x1b[K');
    }

    private replaceLine(newLine: string): void {
        this.clearLine();
        this.lineBuffer = newLine;
        this.cursorPos = newLine.length;
        this.terminal.write(newLine);
    }

    private historyUp(): void {
        if (this.history.length === 0) return;

        if (this.historyIndex === -1) {
            this.savedLine = this.lineBuffer;
            this.historyIndex = this.history.length - 1;
        } else if (this.historyIndex > 0) {
            this.historyIndex--;
        } else {
            return;
        }
        this.replaceLine(this.history[this.historyIndex]);
    }

    private historyDown(): void {
        if (this.historyIndex === -1) return;

        if (this.historyIndex < this.history.length - 1) {
            this.historyIndex++;
            this.replaceLine(this.history[this.historyIndex]);
        } else {
            this.historyIndex = -1;
            this.replaceLine(this.savedLine);
        }
    }

    private addToHistory(line: string): void {
        // Don't add duplicates of the last entry
        if (this.history.length > 0 && this.history[this.history.length - 1] === line) {
            return;
        }
        this.history.push(line);
        if (this.history.length > MAX_HISTORY) {
            this.history.shift();
        }
    }

    private handleLine(line: string): void {
        const trimmed = line.trim();

        // Meta-commands
        if (trimmed.startsWith('/')) {
            this.handleMetaCommand(trimmed);
            return;
        }

        // TIL code
        const output = this.interpreter.interpret(line);
        if (output) {
            for (const l of output.split('\n')) {
                this.terminal.writeln(l);
            }
        }

        this.updateStatus();
    }

    private handleMetaCommand(cmd: string): void {
        switch (cmd.toLowerCase()) {
            case '/help':
                this.terminal.writeln(HELP_TEXT);
                break;
            case '/words':
                const wordsOut = this.interpreter.interpret('words');
                if (wordsOut) {
                    for (const l of wordsOut.split('\n')) {
                        this.terminal.writeln(l);
                    }
                }
                break;
            case '/clear':
                this.terminal.clear();
                break;
            case '/stack':
            case '/s':
                const stack = this.interpreter.getStack();
                this.terminal.writeln(stack);
                break;
            case '/version':
                this.terminal.writeln(`ETIL v${this.interpreter.getVersion()}`);
                break;
            default:
                this.terminal.writeln(`\x1b[31mUnknown command: ${cmd}\x1b[0m`);
                this.terminal.writeln(`Type \x1b[33m/help\x1b[0m for available commands.`);
        }
    }

    private updateStatus(): void {
        const stack = this.interpreter.getStack();
        const statusEl = document.getElementById('status');
        if (statusEl) {
            statusEl.textContent = `Stack: ${stack}`;
            statusEl.className = 'status ready';
        }
    }

    private writePrompt(): void {
        this.terminal.write(this.prompt);
        this.terminal.scrollToBottom();
    }
}
