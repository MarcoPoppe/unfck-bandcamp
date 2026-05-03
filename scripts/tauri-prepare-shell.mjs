#!/usr/bin/env node
/**
 * Prepares the splash shell that Tauri loads at startup. The shell is a
 * static HTML file at `public/tauri-shell/index.html` which polls
 * /api/health on the loopback sidecar and redirects to the real UI once
 * the Next.js standalone server is up.
 *
 * For now this script is a no-op — the shell is hand-written. A future
 * iteration could embed the current package.json version into the splash
 * so a stuck splash makes the version visible. Keeping the script here
 * lets us hook into the build pipeline without changing tauri.conf.json
 * later.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const shellPath = resolve(process.cwd(), 'public', 'tauri-shell', 'index.html');
if (!existsSync(shellPath)) {
  console.error(`[tauri-prepare-shell] Missing shell at ${shellPath}`);
  process.exit(1);
}
console.log(`[tauri-prepare-shell] OK (${shellPath})`);
