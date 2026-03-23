#!/usr/bin/env node
// Build script that injects a timestamp into the bundle

const { execSync } = require('child_process');

const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19) + 'Z';
const define = `--define:BUILD_TIME='"${timestamp}"'`;

const mode = process.argv[2] || 'build';

if (mode === 'dev') {
    execSync(
        `esbuild web/src/main.ts --bundle --outdir=web/dist --servedir=web --serve=8080 --watch ${define}`,
        { stdio: 'inherit' }
    );
} else {
    execSync(
        `esbuild web/src/main.ts --bundle --outdir=web/dist --minify --sourcemap ${define}`,
        { stdio: 'inherit' }
    );
}
