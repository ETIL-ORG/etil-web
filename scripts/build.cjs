#!/usr/bin/env node
// Copyright (c) 2026 Mark Deazley / ETIL-ORG. All rights reserved.
// SPDX-License-Identifier: BSD-3-Clause
//
// Build script that injects version and timestamp into the bundle

const { execSync } = require('child_process');
const pkg = require('../package.json');

const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19) + 'Z';
const defines = [
    `--define:BUILD_TIME='"${timestamp}"'`,
    `--define:WEB_VERSION='"${pkg.version}"'`,
].join(' ');

const mode = process.argv[2] || 'build';

if (mode === 'dev') {
    execSync(
        `esbuild web/src/main.ts --bundle --outdir=web/dist --servedir=web --serve=8080 --watch ${defines}`,
        { stdio: 'inherit' }
    );
} else {
    execSync(
        `esbuild web/src/main.ts --bundle --outdir=web/dist --minify --sourcemap ${defines}`,
        { stdio: 'inherit' }
    );
}
