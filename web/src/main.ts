// Copyright (c) 2026 Mark Deazley / ETIL-ORG. All rights reserved.
// SPDX-License-Identifier: BSD-3-Clause
/**
 * ETIL Browser REPL — Entry point.
 *
 * Tries to load the WASM interpreter. Falls back to mock if unavailable.
 */

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { EtilGlue } from './glue';
import { loadWasmInterpreter } from './wasm-interpreter';
import { MockInterpreter } from './mock-interpreter';

import '@xterm/xterm/css/xterm.css';

async function main(): Promise<void> {
    const container = document.getElementById('terminal-container');
    if (!container) {
        console.error('terminal-container not found');
        return;
    }

    // Create terminal but don't open it yet — prevents Emscripten
    // from finding and writing to the xterm DOM during WASM init
    const terminal = new Terminal({
        fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", Menlo, monospace',
        fontSize: 14,
        lineHeight: 1.2,
        cursorBlink: true,
        cursorStyle: 'block',
        allowProposedApi: true,
        theme: {
            background: '#0a0e1a',
            foreground: '#e0e0e0',
            cursor: '#4fc3f7',
            selectionBackground: '#264f78',
            black: '#0a0e1a',
            red: '#ef5350',
            green: '#66bb6a',
            yellow: '#ffa726',
            blue: '#4fc3f7',
            magenta: '#ce93d8',
            cyan: '#4dd0e1',
            white: '#e0e0e0',
            brightBlack: '#6b7280',
            brightRed: '#ef5350',
            brightGreen: '#81c784',
            brightYellow: '#ffb74d',
            brightBlue: '#81d4fa',
            brightMagenta: '#e1bee7',
            brightCyan: '#80deea',
            brightWhite: '#ffffff',
        },
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());

    // Let browser handle F1-F12, Ctrl+R/L/T/W/N/F/P/G/S/O
    terminal.attachCustomKeyEventHandler((event: KeyboardEvent): boolean => {
        if (event.key.startsWith('F') && event.key.length <= 3) return false;
        if (event.ctrlKey || event.metaKey) {
            if ('rltnwfpgso'.includes(event.key.toLowerCase())) return false;
        }
        return true;
    });

    // Status bar
    const statusEl = document.getElementById('status');
    const setStatus = (text: string, cls: string) => {
        if (statusEl) {
            statusEl.textContent = text;
            statusEl.className = `status ${cls}`;
        }
    };

    setStatus('Loading WASM module...', '');

    // Load WASM module BEFORE opening the terminal — all stdout/stderr
    // during init is silently discarded so nothing touches the DOM
    const wasmInterp = await loadWasmInterpreter(
        () => {},
        () => {},
    );

    // Wait for fonts to load before opening terminal — prevents
    // glyph measurement errors that cause rendering artifacts
    await document.fonts.ready;

    terminal.open(container);
    fitAddon.fit();

    const resizeObserver = new ResizeObserver(() => fitAddon.fit());
    resizeObserver.observe(container);

    let glue: EtilGlue;
    if (wasmInterp) {
        glue = new EtilGlue(terminal, wasmInterp, true, wasmInterp);
        setStatus('Ready (WASM)', 'ready');
    } else {
        glue = new EtilGlue(terminal, new MockInterpreter(), false);
        setStatus('Ready (mock — WASM not loaded)', 'ready');
    }

    glue.init();
    glue.setupDragDrop(container);

    terminal.onData((data) => glue.onData(data));
    terminal.focus();

}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
} else {
    main();
}
