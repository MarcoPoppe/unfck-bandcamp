#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![commands::open_bandcamp_login])
        .setup(|app| {
            // In release builds we spawn the Next.js standalone server as
            // a sidecar process. Node is bundled with the app via the
            // tauri externalBin mechanism — see release.yml which fetches
            // the official Node binary per OS-triple before bundling.
            // In debug builds Tauri's beforeDevCommand already runs
            // `npm run dev`, so we skip the spawn there.
            if !cfg!(debug_assertions) {
                sidecar::spawn_nextjs_server(app.handle())?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

mod commands {
    use std::time::Duration;
    use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

    /// Spawns a child WebView at bandcamp.com/login, polls the URL until
    /// the user has signed in (post-login URL contains the user's
    /// username), then reads the session cookies and returns them so the
    /// setup wizard can pass them to /api/auth/validate.
    ///
    /// Status: scaffolded with the navigation polling loop. The
    /// `cookies_for_url`-style API to actually pull HttpOnly session
    /// cookies out of the WebView is platform-specific (WebView2 on
    /// Windows, WKWebView on macOS, WebKitGTK on Linux) and Tauri 2's
    /// stable surface for it is still in flux. The wizard handles a
    /// returned-empty cookieString gracefully and falls back to the
    /// paste flow, so this stub is safe to ship.
    #[tauri::command]
    pub async fn open_bandcamp_login(
        app: AppHandle,
        role: String,
    ) -> Result<LoginResult, String> {
        if role != "crawler" && role != "main" {
            return Err(format!("invalid role: {role}"));
        }
        let label = format!("bc-login-{role}");

        // Re-use an existing window if the user clicked again.
        if let Some(existing) = app.get_webview_window(&label) {
            existing.set_focus().ok();
        } else {
            let url = "https://bandcamp.com/login"
                .parse()
                .map_err(|e: url::ParseError| e.to_string())?;
            WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(url))
                .title("Sign in to Bandcamp")
                .inner_size(900.0, 700.0)
                .build()
                .map_err(|e| format!("failed to open login window: {e}"))?;
        }

        // Poll the WebView URL up to 5 minutes. When it lands on a
        // post-login page (anything under bandcamp.com/<something>
        // that's not /login or /signup), we're done logging in.
        let timeout = std::time::Instant::now() + Duration::from_secs(300);
        let detected_username: Option<String>;
        loop {
            if std::time::Instant::now() > timeout {
                if let Some(w) = app.get_webview_window(&label) {
                    w.close().ok();
                }
                return Err("Login timed out (5 minutes).".into());
            }

            if let Some(w) = app.get_webview_window(&label) {
                let url = w.url().map_err(|e| e.to_string())?;
                let s = url.to_string();
                if s.starts_with("https://bandcamp.com/")
                    && !s.contains("/login")
                    && !s.contains("/signup")
                    && !s.contains("/forgot")
                {
                    if let Some(rest) = s.strip_prefix("https://bandcamp.com/") {
                        let user = rest
                            .split('/')
                            .next()
                            .unwrap_or("")
                            .split('?')
                            .next()
                            .unwrap_or("")
                            .trim();
                        if !user.is_empty() {
                            detected_username = Some(user.to_string());
                            break;
                        }
                    }
                }
            } else {
                // user closed the window
                return Err("Login window was closed before sign-in finished.".into());
            }

            tokio::time::sleep(Duration::from_millis(500)).await;
        }

        // TODO: pull HttpOnly session cookies out of the WebView's
        // cookie store. Once Tauri exposes a stable cross-platform API
        // for that, populate `cookie_string` here and the wizard will
        // forward it to /api/auth/validate. Until then we return an
        // empty string and the wizard surfaces a polite fallback hint.
        let cookie_string = String::new();
        if let Some(w) = app.get_webview_window(&label) {
            w.close().ok();
        }
        Ok(LoginResult {
            cookie_string,
            fan_id: None,
            username: detected_username,
            role,
        })
    }

    #[derive(serde::Serialize)]
    pub struct LoginResult {
        pub cookie_string: String,
        pub fan_id: Option<u64>,
        pub username: Option<String>,
        pub role: String,
    }
}

mod sidecar {
    use std::path::{Path, PathBuf};
    use tauri::{AppHandle, Manager};
    use tauri_plugin_shell::process::CommandEvent;
    use tauri_plugin_shell::ShellExt;

    /// Tauri's resource_dir() returns Windows extended-length paths like
    /// `\\?\C:\Users\…`. Node accepts those as command-line args but
    /// some legacy code paths and child processes don't, so we strip
    /// the verbatim prefix back to a plain `C:\Users\…` form.
    fn strip_extended_prefix(p: &Path) -> PathBuf {
        let s = p.to_string_lossy();
        if let Some(rest) = s.strip_prefix(r"\\?\") {
            // UNC paths under verbatim prefix look like \\?\UNC\server\share —
            // turn back into \\server\share.
            if let Some(unc) = rest.strip_prefix("UNC\\") {
                return PathBuf::from(format!(r"\\{}", unc));
            }
            return PathBuf::from(rest);
        }
        p.to_path_buf()
    }

    /// Default loopback port for the embedded Next.js server. Matches the
    /// `npm run dev` script so a developer who runs `tauri dev` sees the
    /// same UI as a release build.
    pub const PORT: u16 = 3457;

    pub fn spawn_nextjs_server(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
        // Resource dir contains the bundled standalone server tree.
        // Tauri exposes the resolved app-resource path; the
        // `.next/standalone` tree was registered as a bundle resource in
        // tauri.conf.json so it lives under `<resource_dir>/_up_/.next/standalone`.
        // Tauri returns extended-length paths (\\?\C:\...) on Windows.
        // Node tolerates them as args but server.js's internal relative
        // requires get confused if CWD also stays in the verbatim form.
        // Strip the prefix so we hand Node plain Win32 paths.
        let resource_dir_raw = app.path().resource_dir()?;
        let resource_dir = strip_extended_prefix(&resource_dir_raw);
        let standalone_dir = resource_dir
            .join("_up_")
            .join(".next")
            .join("standalone");
        let server_js = standalone_dir.join("server.js");

        // Per-user data dir for the SQLite database, audio cache, logs.
        // The Next.js process reads $DATABASE_PATH (the existing
        // instrumentation hook honours it).
        let data_dir = app.path().app_data_dir()?.join("data");
        std::fs::create_dir_all(&data_dir).ok();

        log::info!(
            "Spawning Next.js sidecar: bundled-node {} (port {}, data {})",
            server_js.display(),
            PORT,
            data_dir.display()
        );

        if !server_js.exists() {
            log::error!(
                "server.js not found at expected path {} — bundle resource layout mismatch",
                server_js.display()
            );
        }

        // Use Tauri's sidecar API: it resolves the bundled node binary
        // (named `node-<TARGET_TRIPLE>` in src-tauri/binaries/) at
        // runtime and spawns it. No PATH-Node needed on the user's
        // machine — Marco's friends just install + click + go.
        let db_path_str = data_dir.join("unfck.db").to_string_lossy().to_string();
        let data_dir_str = data_dir.to_string_lossy().to_string();
        // CWD must be the standalone tree itself: server.js does
        // `require('./.next/server/...')` style relative loads, which
        // only resolve correctly when Node is running with that
        // directory as its working directory.
        let (mut rx, _child) = app
            .shell()
            .sidecar("node")?
            .args(["server.js"])
            .current_dir(standalone_dir.clone())
            .env("PORT", PORT.to_string())
            .env("HOSTNAME", "127.0.0.1")
            .env("DATABASE_PATH", db_path_str)
            .env("UNFCK_DATA_DIR", data_dir_str)
            .spawn()?;

        // Pipe sidecar stdout/stderr into our log so we can diagnose
        // boot failures from the user's machine. Writes go to whatever
        // tauri-plugin-log is configured for (default: app log dir).
        tauri::async_runtime::spawn(async move {
            while let Some(event) = rx.recv().await {
                match event {
                    CommandEvent::Stdout(line) => {
                        log::info!("[sidecar] {}", String::from_utf8_lossy(&line));
                    }
                    CommandEvent::Stderr(line) => {
                        log::warn!("[sidecar] {}", String::from_utf8_lossy(&line));
                    }
                    CommandEvent::Error(e) => {
                        log::error!("[sidecar error] {}", e);
                    }
                    CommandEvent::Terminated(payload) => {
                        log::error!(
                            "[sidecar terminated] code={:?} signal={:?}",
                            payload.code, payload.signal
                        );
                    }
                    _ => {}
                }
            }
        });

        Ok(())
    }
}
