// Copyright (c) 2026 Mark Deazley / ETIL-ORG. All rights reserved.
// SPDX-License-Identifier: BSD-3-Clause
/**
 * HTTP fetch bridge for the ETIL browser REPL.
 *
 * Wraps the browser's fetch() API with CORS error handling
 * and result formatting for terminal display.
 */

export interface FetchResult {
    ok: boolean;
    status: number;
    statusText: string;
    body: string;
    headers: Record<string, string>;
    error?: string;
}

/**
 * Perform a GET request via fetch().
 * Returns a formatted result suitable for terminal display.
 */
export async function fetchGet(
    url: string,
    headers?: Record<string, string>,
): Promise<FetchResult> {
    return doFetch(url, 'GET', headers);
}

/**
 * Perform a POST request via fetch().
 */
export async function fetchPost(
    url: string,
    body: string,
    headers?: Record<string, string>,
): Promise<FetchResult> {
    return doFetch(url, 'POST', headers, body);
}

async function doFetch(
    url: string,
    method: string,
    headers?: Record<string, string>,
    body?: string,
): Promise<FetchResult> {
    // Basic URL validation
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return {
            ok: false, status: 0, statusText: '',
            body: '', headers: {},
            error: `Invalid URL: ${url}`,
        };
    }

    // Only allow http/https
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return {
            ok: false, status: 0, statusText: '',
            body: '', headers: {},
            error: `Unsupported protocol: ${parsed.protocol}`,
        };
    }

    try {
        const fetchHeaders: Record<string, string> = { ...headers };
        if (method === 'POST' && !fetchHeaders['Content-Type']) {
            fetchHeaders['Content-Type'] = 'text/plain';
        }

        const response = await fetch(url, {
            method,
            headers: fetchHeaders,
            body: method === 'POST' ? body : undefined,
            signal: AbortSignal.timeout(10000), // 10s timeout
        });

        const responseBody = await response.text();

        // Collect response headers
        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
            responseHeaders[key] = value;
        });

        return {
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            body: responseBody,
            headers: responseHeaders,
        };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        // Detect CORS errors
        if (message.includes('Failed to fetch') || message.includes('NetworkError')) {
            return {
                ok: false, status: 0, statusText: '',
                body: '', headers: {},
                error: `Network error (likely CORS blocked): ${url}\n` +
                       `The target server must set Access-Control-Allow-Origin headers.`,
            };
        }

        // Timeout
        if (message.includes('AbortError') || message.includes('timeout')) {
            return {
                ok: false, status: 0, statusText: '',
                body: '', headers: {},
                error: `Request timed out after 10s: ${url}`,
            };
        }

        return {
            ok: false, status: 0, statusText: '',
            body: '', headers: {},
            error: `Fetch error: ${message}`,
        };
    }
}

/**
 * Format a FetchResult for terminal display.
 */
export function formatResult(result: FetchResult): string[] {
    const lines: string[] = [];

    if (result.error) {
        lines.push(`\x1b[31m${result.error}\x1b[0m`);
        return lines;
    }

    // Status line
    const statusColor = result.ok ? '32' : '31';
    lines.push(`\x1b[${statusColor}m${result.status} ${result.statusText}\x1b[0m`);

    // Body (truncate at 10KB for display)
    const body = result.body.length > 10240
        ? result.body.substring(0, 10240) + '\n\x1b[90m... (truncated)\x1b[0m'
        : result.body;

    if (body) {
        for (const line of body.split('\n')) {
            lines.push(line);
        }
    }

    return lines;
}
