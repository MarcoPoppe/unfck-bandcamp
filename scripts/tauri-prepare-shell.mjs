#!/usr/bin/env node
/**
 * Prepares the Tauri bundle inputs:
 *
 *   1. Verifies the splash shell exists at `public/tauri-shell/index.html`
 *      (Tauri loads this static page until the embedded sidecar comes up).
 *   2. Materialises the Next.js standalone tree by copying the assets the
 *      `output: 'standalone'` build deliberately leaves out:
 *        - `.next/static/`  (CSS, JS chunks, fonts, hashed-asset bundles)
 *        - `public/`        (icons, splash-shell, anything in repo /public)
 *      into the standalone tree so `next start`-style relative paths
 *      resolve at runtime.
 *
 * Why this script exists: `next build` with `output: 'standalone'`
 * produces `.next/standalone/server.js` plus a minimal node_modules, but
 * does NOT copy `.next/static` or `public`. The Next.js docs explicitly
 * say the deploying party has to copy them. When Tauri later bundles
 * `.next/standalone/**` as resources, missing those folders means the
 * sidecar boots, the page renders server-side, but every CSS/JS asset
 * 404s and React never hydrates — the UI looks unstyled and forms stop
 * working. Doing the copy here keeps `tauri.conf.json` simple (one
 * `resources` glob) and the runtime layout self-consistent.
 */
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const cwd = process.cwd();
const shellPath = resolve(cwd, 'public', 'tauri-shell', 'index.html');
if (!existsSync(shellPath)) {
  console.error(`[tauri-prepare-shell] Missing shell at ${shellPath}`);
  process.exit(1);
}
console.log(`[tauri-prepare-shell] Shell OK (${shellPath})`);

const standaloneDir = resolve(cwd, '.next', 'standalone');
if (!existsSync(standaloneDir)) {
  console.error(
    `[tauri-prepare-shell] Missing ${standaloneDir} — run \`next build\` first.`,
  );
  process.exit(1);
}

// Copy .next/static -> .next/standalone/.next/static
{
  const src = resolve(cwd, '.next', 'static');
  const dst = resolve(standaloneDir, '.next', 'static');
  if (!existsSync(src)) {
    console.error(`[tauri-prepare-shell] Missing ${src}`);
    process.exit(1);
  }
  rmSync(dst, { recursive: true, force: true });
  mkdirSync(resolve(standaloneDir, '.next'), { recursive: true });
  cpSync(src, dst, { recursive: true });
  console.log(`[tauri-prepare-shell] Copied .next/static/ -> standalone tree`);
}

// Copy public/ -> .next/standalone/public
{
  const src = resolve(cwd, 'public');
  const dst = resolve(standaloneDir, 'public');
  if (!existsSync(src)) {
    console.error(`[tauri-prepare-shell] Missing ${src}`);
    process.exit(1);
  }
  rmSync(dst, { recursive: true, force: true });
  cpSync(src, dst, { recursive: true });
  console.log(`[tauri-prepare-shell] Copied public/ -> standalone tree`);
}

console.log('[tauri-prepare-shell] Done.');
