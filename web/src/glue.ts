/**
 * WASM <-> xterm.js bridge.
 *
 * Handles line editing, command history, meta-commands,
 * and routes TIL code to the interpreter.
 */

import type { Terminal } from '@xterm/xterm';
import type { EtilInterpreter } from './types';
import type { WasmInterpreter } from './wasm-interpreter';
import { fetchGet, fetchPost, formatResult } from './fetch-bridge';

// Injected by esbuild --define:BUILD_TIME at build time
declare const BUILD_TIME: string;

const MAX_HISTORY = 100;

const HELP_LINES = [
    '\x1b[36mETIL Browser REPL — Commands\x1b[0m',
    '',
    '  \x1b[33m/help\x1b[0m               Show this help',
    '  \x1b[33m/words\x1b[0m              List all dictionary words',
    '  \x1b[33m/clear\x1b[0m              Clear the terminal',
    '  \x1b[33m/stack\x1b[0m              Show the data stack',
    '  \x1b[33m/version\x1b[0m            Show ETIL version',
    '  \x1b[33m/ls [path]\x1b[0m          List files in /home',
    '  \x1b[33m/upload\x1b[0m             Upload a .til file (opens file picker)',
    '  \x1b[33m/download <path>\x1b[0m    Download a file from /home',
    '  \x1b[33m/export\x1b[0m             Export /home as JSON archive',
    '  \x1b[33m/import\x1b[0m             Import a JSON archive into /home',
    '  \x1b[33m/get <url>\x1b[0m          HTTP GET (subject to CORS)',
    '  \x1b[33m/post <url> <body>\x1b[0m  HTTP POST (subject to CORS)',
    '',
    '  Type any TIL code at the prompt.',
    '  Example: \x1b[32m42 dup + .\x1b[0m',
    '  Example: \x1b[32m: double dup + ; 21 double .\x1b[0m',
    '  Example: \x1b[32minclude /home/hello.til\x1b[0m',
];

export class EtilGlue {
    private terminal: Terminal;
    private interpreter: EtilInterpreter;
    private wasmInterp: WasmInterpreter | null;
    private lineBuffer: string = '';
    private cursorPos: number = 0;
    private prompt = '> ';
    private isWasm: boolean;
    private history: string[] = [];
    private historyIndex: number = -1;
    private savedLine: string = '';

    constructor(terminal: Terminal, interpreter: EtilInterpreter, isWasm: boolean, wasmInterp?: WasmInterpreter | null) {
        this.terminal = terminal;
        this.interpreter = interpreter;
        this.isWasm = isWasm;
        this.wasmInterp = wasmInterp ?? null;
    }

    /** Display banner and prompt */
    init(): void {
        const version = this.interpreter.getVersion();
        const mode = this.isWasm ? 'WASM' : 'mock';
        const buildTime = BUILD_TIME;

        this.terminal.writeln(`\x1b[36mETIL v${version}\x1b[0m — Evolutionary Threaded Interpretive Language`);

        if (this.isWasm) {
            // Count words by capturing 'words' output and counting tokens
            const wordsOutput = this.interpreter.interpret('words');
            const wordCount = wordsOutput.trim().split(/\s+/).filter(w => w.length > 0).length;
            this.terminal.writeln(`\x1b[90m${wordCount} words loaded (${mode}) — type /help for commands\x1b[0m`);
        } else {
            this.terminal.writeln(`\x1b[90mBrowser REPL (${mode}) — type /help for commands\x1b[0m`);
        }

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
                for (const line of HELP_LINES) {
                    this.terminal.writeln(line);
                }
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
            case '/upload':
                this.cmdUpload();
                break;
            case '/export':
                this.cmdExport();
                break;
            case '/import':
                this.cmdImport();
                break;
            default: {
                // Commands with arguments
                const lower = cmd.toLowerCase();
                if (lower.startsWith('/download ')) {
                    this.cmdDownload(cmd.substring(10).trim());
                } else if (lower.startsWith('/ls')) {
                    this.cmdLs(cmd.substring(3).trim());
                } else if (lower.startsWith('/get ')) {
                    this.cmdFetchGet(cmd.substring(5).trim());
                } else if (lower.startsWith('/post ')) {
                    this.cmdFetchPost(cmd.substring(6).trim());
                } else {
                    this.terminal.writeln(`\x1b[31mUnknown command: ${cmd}\x1b[0m`);
                    this.terminal.writeln(`Type \x1b[33m/help\x1b[0m for available commands.`);
                }
                break;
            }
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

    // ---- File meta-commands ----

    private cmdLs(path: string): void {
        if (!this.wasmInterp) {
            this.terminal.writeln('\x1b[31mFile operations require WASM interpreter\x1b[0m');
            return;
        }
        const dir = path || '/home';
        const files = this.wasmInterp.listDir(dir);
        if (files.length === 0) {
            this.terminal.writeln(`\x1b[90m(empty)\x1b[0m`);
        } else {
            for (const f of files) {
                this.terminal.writeln(f);
            }
        }
    }

    private cmdUpload(): void {
        if (!this.wasmInterp) {
            this.terminal.writeln('\x1b[31mFile operations require WASM interpreter\x1b[0m');
            return;
        }
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.til,.txt';
        input.multiple = true;
        input.onchange = () => {
            if (!input.files) return;
            for (const file of input.files) {
                const reader = new FileReader();
                reader.onload = () => {
                    const content = reader.result as string;
                    if (this.wasmInterp!.writeFile(`/home/${file.name}`, content)) {
                        this.terminal.writeln(`\x1b[32mUploaded ${file.name} (${content.length} bytes)\x1b[0m`);
                    } else {
                        this.terminal.writeln(`\x1b[31mFailed to write ${file.name}\x1b[0m`);
                    }
                    this.writePrompt();
                };
                reader.readAsText(file);
            }
        };
        input.click();
    }

    private cmdDownload(path: string): void {
        if (!this.wasmInterp) {
            this.terminal.writeln('\x1b[31mFile operations require WASM interpreter\x1b[0m');
            return;
        }
        if (!path) {
            this.terminal.writeln('\x1b[31mUsage: /download <path>\x1b[0m');
            return;
        }
        const fullPath = path.startsWith('/') ? path : `/home/${path}`;
        const content = this.wasmInterp.readFile(fullPath);
        if (content === null) {
            this.terminal.writeln(`\x1b[31mFile not found: ${fullPath}\x1b[0m`);
            return;
        }
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = path.split('/').pop() || 'download.til';
        a.click();
        URL.revokeObjectURL(url);
        this.terminal.writeln(`\x1b[32mDownloading ${a.download}\x1b[0m`);
    }

    private cmdExport(): void {
        if (!this.wasmInterp) {
            this.terminal.writeln('\x1b[31mFile operations require WASM interpreter\x1b[0m');
            return;
        }
        // Walk /home recursively and build a simple JSON manifest
        // (tar.gz would require a library — JSON export is simpler and works)
        const files: Record<string, string> = {};
        const walk = (dir: string) => {
            const entries = this.wasmInterp!.listDir(dir);
            for (const name of entries) {
                const fullPath = `${dir}/${name}`;
                try {
                    const stat = this.wasmInterp!.fs.stat(fullPath);
                    if (this.wasmInterp!.fs.isDir(stat.mode)) {
                        walk(fullPath);
                    } else {
                        const content = this.wasmInterp!.readFile(fullPath);
                        if (content !== null) {
                            // Store relative to /home
                            const relPath = fullPath.replace(/^\/home\//, '');
                            files[relPath] = content;
                        }
                    }
                } catch { /* skip unreadable */ }
            }
        };
        walk('/home');

        const count = Object.keys(files).length;
        if (count === 0) {
            this.terminal.writeln('\x1b[90m/home is empty — nothing to export\x1b[0m');
            return;
        }

        const json = JSON.stringify(files, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const ts = new Date().toISOString().replace(/[:.]/g, '').substring(0, 15);
        a.href = url;
        a.download = `etil-home-${ts}.json`;
        a.click();
        URL.revokeObjectURL(url);
        this.terminal.writeln(`\x1b[32mExported ${count} files as ${a.download}\x1b[0m`);
    }

    private cmdImport(): void {
        if (!this.wasmInterp) {
            this.terminal.writeln('\x1b[31mFile operations require WASM interpreter\x1b[0m');
            return;
        }
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = () => {
            if (!input.files || input.files.length === 0) return;
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const files = JSON.parse(reader.result as string) as Record<string, string>;
                    let count = 0;
                    const maxSize = 50 * 1024 * 1024; // 50 MB guard
                    let totalSize = 0;

                    for (const content of Object.values(files)) {
                        totalSize += content.length;
                    }
                    if (totalSize > maxSize) {
                        this.terminal.writeln(`\x1b[31mImport rejected: ${(totalSize / 1024 / 1024).toFixed(1)} MB exceeds 50 MB limit\x1b[0m`);
                        this.writePrompt();
                        return;
                    }

                    for (const [relPath, content] of Object.entries(files)) {
                        const fullPath = `/home/${relPath}`;
                        // Create parent directories
                        const parts = fullPath.split('/');
                        for (let i = 2; i < parts.length - 1; i++) {
                            const dir = parts.slice(0, i + 1).join('/');
                            try { this.wasmInterp!.fs.mkdir(dir); } catch { /* exists */ }
                        }
                        if (this.wasmInterp!.writeFile(fullPath, content)) {
                            count++;
                        }
                    }
                    this.terminal.writeln(`\x1b[32mImported ${count} files into /home\x1b[0m`);
                } catch (err) {
                    this.terminal.writeln(`\x1b[31mImport failed: invalid JSON\x1b[0m`);
                }
                this.writePrompt();
            };
            reader.readAsText(input.files[0]);
        };
        input.click();
    }

    // ---- HTTP fetch commands ----

    private cmdFetchGet(url: string): void {
        if (!url) {
            this.terminal.writeln('\x1b[31mUsage: /get <url>\x1b[0m');
            return;
        }
        this.terminal.writeln(`\x1b[90mGET ${url}...\x1b[0m`);
        fetchGet(url).then(result => {
            for (const line of formatResult(result)) {
                this.terminal.writeln(line);
            }
            this.writePrompt();
        });
    }

    private cmdFetchPost(args: string): void {
        // Split on first space: url body
        const spaceIdx = args.indexOf(' ');
        if (spaceIdx === -1) {
            this.terminal.writeln('\x1b[31mUsage: /post <url> <body>\x1b[0m');
            return;
        }
        const url = args.substring(0, spaceIdx);
        const body = args.substring(spaceIdx + 1);
        this.terminal.writeln(`\x1b[90mPOST ${url}...\x1b[0m`);
        fetchPost(url, body).then(result => {
            for (const line of formatResult(result)) {
                this.terminal.writeln(line);
            }
            this.writePrompt();
        });
    }

    /** Set up drag-and-drop file upload on the terminal container */
    setupDragDrop(container: HTMLElement): void {
        container.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });

        container.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!this.wasmInterp || !e.dataTransfer?.files) return;

            for (const file of e.dataTransfer.files) {
                const reader = new FileReader();
                reader.onload = () => {
                    const content = reader.result as string;
                    if (this.wasmInterp!.writeFile(`/home/${file.name}`, content)) {
                        this.terminal.writeln(`\r\n\x1b[32mDropped: ${file.name} (${content.length} bytes)\x1b[0m`);
                    } else {
                        this.terminal.writeln(`\r\n\x1b[31mFailed to write ${file.name}\x1b[0m`);
                    }
                    this.writePrompt();
                };
                reader.readAsText(file);
            }
        });
    }
}
