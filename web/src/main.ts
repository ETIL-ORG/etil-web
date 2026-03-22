/**
 * ETIL Browser REPL — Entry point.
 *
 * Initializes xterm.js terminal, connects the WASM glue layer,
 * and manages terminal resize via the fit addon.
 */

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { EtilGlue } from './glue';

// Import xterm.js CSS — esbuild bundles this
import '@xterm/xterm/css/xterm.css';

function main(): void {
    const container = document.getElementById('terminal-container');
    if (!container) {
        console.error('terminal-container not found');
        return;
    }

    // Create terminal
    const terminal = new Terminal({
        fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", Menlo, monospace',
        fontSize: 14,
        lineHeight: 1.2,
        cursorBlink: true,
        cursorStyle: 'block',
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

    // Addons
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());

    // Mount terminal
    terminal.open(container);
    fitAddon.fit();

    // Resize on window resize
    const resizeObserver = new ResizeObserver(() => {
        fitAddon.fit();
    });
    resizeObserver.observe(container);

    // Initialize ETIL glue layer
    const glue = new EtilGlue(terminal);
    glue.init();

    // Wire input
    terminal.onData((data) => {
        glue.onData(data);
    });

    // Update status
    const statusEl = document.getElementById('status');
    if (statusEl) {
        statusEl.textContent = 'Ready (mock interpreter)';
        statusEl.className = 'status ready';
    }

    // Focus terminal
    terminal.focus();
}

// Run when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
} else {
    main();
}
