# Tauri Distribution + GitHub Releases + Auto-Updater

**Date:** 2026-05-03
**Target version:** 2.0.0 (major bump — first installable release)

## Goal

Ship a one-click installer per OS so non-technical friends can run the app
without Docker, Node, or DevTools. Embedded-browser login replaces the
cookie-paste setup flow. Self-hosted updates via GitHub Releases.

## Why Tauri (and not Electron)

- ~5 MB bundle vs Electron's ~120 MB. Tauri uses the OS-native webview
  (WebView2 on Windows, WKWebView on macOS, WebKitGTK on Linux).
- Rust backend means cookies extracted from the embedded webview never
  hit Node — handled in-process, written straight into the SQLite layer
  via a custom Tauri command.
- Tauri ships an official updater plugin with GPG-signed manifests.
- Distribution-ready GitHub Actions templates exist for each OS.

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  Tauri executable (Rust)                                         │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Sidecar: Next.js production server (next start)           │  │
│  │  Listens on 127.0.0.1:<random-port>                        │  │
│  │  Reads/writes ./data/ (SQLite, audio cache, logs)          │  │
│  └────────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  WebView (system)                                          │  │
│  │  Loads http://127.0.0.1:<port>/                            │  │
│  │  Plus: bandcamp.com login pages on demand for auth         │  │
│  └────────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Tauri commands (Rust → JS bridge):                        │  │
│  │   - open_bandcamp_login(role) → spawns webview, returns    │  │
│  │     cookies + fan_id once /collection_summary loads        │  │
│  │   - check_for_updates() → manual update probe              │  │
│  │   - quit_app(), open_data_folder(), copy_diagnostics()     │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

The Next.js server runs as a sidecar process spawned by the Tauri Rust
binary. The WebView talks to it over loopback. Cookies and audio data
sit under the user's app-data dir (`%APPDATA%/unfck-bandcamp/data` on
Windows, `~/Library/Application Support/unfck-bandcamp/data` on macOS,
`~/.local/share/unfck-bandcamp/data` on Linux). DATABASE_PATH env var
is set by Tauri before spawning the sidecar.

## Embedded-browser login flow

Replaces the current cookie-paste in `/setup`. Steps:

1. User clicks "Sign in with Bandcamp" in the setup wizard.
2. Tauri command opens a second WebView pointed at
   `https://bandcamp.com/login`.
3. User logs in normally (handles captchas, 2FA, password managers — all
   the things automated login can't handle reliably).
4. Once the post-login redirect lands on `bandcamp.com/<username>`, Tauri
   reads the WebView's cookies, extracts the relevant ones, plus the
   `fan_id` from the page blob.
5. Tauri command writes them to the running sidecar's auth store via
   the existing `/api/auth/validate` endpoint, with `role` set by the
   wizard step (crawler or main).
6. WebView closes, setup wizard advances.

Cookies never touch the user's clipboard or pass through Node — pure
browser-internal extraction. ToS-clean: it's a regular browser session
the user logged into themselves.

## GitHub Releases pipeline

`.github/workflows/release.yml`:
- Trigger: push of a tag matching `v*.*.*`.
- Matrix: `windows-latest`, `macos-latest`, `ubuntu-22.04` runners.
- Steps per runner:
  - Check out repo
  - Install Rust + Tauri CLI (cached)
  - `npm ci`
  - `npm run build` (Next.js production build, output bundled into Tauri)
  - `tauri build` — produces signed installer for the runner's OS
  - Upload artifact
- Aggregate job: tauri-action's `tauri-action@v0` collects all artifacts
  and the `latest.json` manifest into one GitHub Release.

Manifest (`latest.json`) shape (Tauri-defined):
```json
{
  "version": "2.0.0",
  "notes": "...changelog...",
  "pub_date": "2026-05-03T12:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "...",
      "url": "https://github.com/<user>/unfck-bandcamp/releases/download/v2.0.0/unfck-bandcamp_2.0.0_x64-setup.exe.zip"
    },
    "darwin-x86_64": { ... },
    "darwin-aarch64": { ... },
    "linux-x86_64": { ... }
  }
}
```

Release assets are published as soon as the workflow completes; the
public download page at `github.com/<user>/unfck-bandcamp/releases/latest`
shows them automatically with per-OS sections.

## Updater plugin

`tauri-plugin-updater` configured in `tauri.conf.json`:
- `endpoints`: URL to `latest.json` on GitHub raw content.
- `pubkey`: Tauri's update-signing public key (paired with a private key
  kept as a GitHub secret).
- App checks on launch + every 24h; when a new version is available a
  small banner prompts the user "Update to vX.Y.Z?". Click → download
  + restart automatically.

## Code signing — phased

**Phase 1 (initial release):** unsigned. Friends will see SmartScreen on
Windows ("unrecognized publisher", click "Run anyway") and Gatekeeper on
macOS ("can't open because Apple cannot check it for malicious software"
→ right-click → Open). Acceptable for a small friend-test cohort, jarring
otherwise.

**Phase 2 (if we go beyond a friend test):**
- Windows: EV Code Signing Certificate (~$300/year). One-time setup, then
  workflow signs binaries automatically.
- macOS: Apple Developer Program ($99/year) + notarization step in the
  workflow. Removes the Gatekeeper warning entirely.
- Linux: AppImage and `.deb` signing optional, less commonly enforced.

## Phase plan (concrete)

### Phase 1 — bootstrap (4-6h)
1. Initialize git repo, push to GitHub (private at first).
2. `npm install --save-dev @tauri-apps/cli`.
3. `npx tauri init` — interactive, accept defaults except: `frontend
   distDir = ".next/standalone"`, `devPath = "http://localhost:3457"`,
   `bundle identifier = "com.unfck.bandcamp"`.
4. Create `src-tauri/tauri.conf.json` overrides:
   - Sidecar definition pointing at `node` + standalone server.js.
   - DATABASE_PATH env injection from app-data dir.
   - WebView size, title, icon.
5. Smoke test: `npm run tauri dev` opens the app in a Tauri window.

### Phase 2 — embedded login (3-4h)
6. Implement `open_bandcamp_login` Tauri command in Rust:
   - Spawn second WebView with `https://bandcamp.com/login`.
   - Listen for navigation events; when URL matches
     `bandcamp.com/<username>`, extract cookies via `WebView.cookies()`.
   - Read `pagedata` from the page HTML to grab `fan_id`.
   - Return `{cookieString, fanId, username, email}` to the JS side.
7. Setup wizard JS calls the command instead of accepting paste input.
   Replace the textarea + Validate button with a single
   "Sign in with Bandcamp" button per role.

### Phase 3 — release pipeline (2-3h)
8. Generate Tauri update keypair: `tauri signer generate`. Store private
   key as `TAURI_PRIVATE_KEY` GitHub secret. Embed public key in
   `tauri.conf.json`.
9. Write `.github/workflows/release.yml` using `tauri-action`. Test by
   tagging `v0.0.1-test`.
10. Verify the auto-generated release page renders all three OS assets.

### Phase 4 — updater (1-2h)
11. Add `tauri-plugin-updater` to dependencies.
12. Wire a small UpdaterBanner React component that calls
    `checkUpdate()` from `@tauri-apps/plugin-updater` on app mount and
    on user-triggered "Check for updates" button in `/setup`.
13. End-to-end test: bump version, tag, wait for release, restart app,
    confirm update prompt appears and applies cleanly.

### Phase 5 — first friend test (2-3h)
14. Fresh Windows VM (or fresh user account on existing Windows box).
    Install nothing else. Download the .msi, run, walk through setup,
    sync library, play a track. Note every UX speed bump.
15. Same drill on a Mac if accessible.
16. Fix the speed bumps.
17. Send Discord/WhatsApp invite link with the GitHub Releases URL to
    one or two friends, watch what happens.

## Open questions / risks

- **Cookie storage in WebView2 vs WKWebView vs WebKitGTK** — APIs
  differ slightly. Tauri abstracts most of it but extraction-from-second-
  webview behaviour needs spot-testing per OS. Estimate buffer: +2h.
- **Static export vs sidecar.** Decided sidecar because we have API
  routes (`/api/sync/*`, `/api/audio/stream` etc.) that need a real
  server. Static export would force every API into client-side calls
  to bandcamp.com, breaking the loopback security model.
- **First-launch performance.** Sidecar boot adds ~1-2s before WebView
  paints. Acceptable; can show splash if jarring.
- **better-sqlite3 native binary** must build for each target arch in
  the workflow. `tauri-action` handles cross-arch but watch for
  prebuilds-fallback errors on first run.

## Out of scope for v2.0.0

- Auto-launch on system boot.
- System tray icon + minimize-to-tray.
- Per-user notification toasts (browser notifications work, system
  notifications would need Tauri permission setup).
- Code signing (Phase 2 if we go past friend test).

## Effort estimate (rough)

- Bootstrap: 4-6h
- Embedded login: 3-4h
- Release pipeline: 2-3h
- Updater: 1-2h
- Friend-test loop: 2-3h
- Buffer for OS-specific WebView quirks: 2-4h

Total: **1.5-2 working days**.
