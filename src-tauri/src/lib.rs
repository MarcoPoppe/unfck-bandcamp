#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            commands::open_bandcamp_login,
            commands::wait_for_server,
        ])
        .on_window_event(|window, event| {
            // We don't intercept close in Rust — the frontend's
            // onCloseRequested listener decides whether to hide-to-tray
            // based on the user's saved preference. Rust here only logs
            // for diagnostics.
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                log::info!("window close requested: {}", window.label());
            }
        })
        .setup(|app| {
            // In release builds we spawn the Next.js standalone server as
            // a sidecar process. Node is bundled with the app via the
            // tauri externalBin mechanism — see release.yml which fetches
            // the official Node binary per OS-triple before bundling.
            // In debug builds Tauri's beforeDevCommand already runs
            // `npm run dev`, so we skip the spawn there.
            //
            // Stale-sidecar guard: if the loopback port is already
            // listening (previous instance still alive, or the user
            // started a manual `npm run start` on the same port), don't
            // spawn a second Node — it would die with EADDRINUSE and
            // poison the log. Splash will reach the existing server.
            if !cfg!(debug_assertions) {
                if sidecar::is_port_listening(sidecar::PORT) {
                    log::warn!(
                        "Port {} already in use — skipping sidecar spawn (existing server will be reused).",
                        sidecar::PORT
                    );
                } else {
                    sidecar::spawn_nextjs_server(app.handle())?;
                }
            }
            tray::install(app.handle())?;
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

    /// Polls the loopback port until the bundled Next.js sidecar is
    /// ready to accept connections. The splash HTML calls this via
    /// Tauri IPC instead of doing a cross-origin fetch — that way we
    /// avoid the `tauri.localhost → 127.0.0.1:3457` CORS dance and
    /// keep the API surface closed to external origins.
    #[tauri::command]
    pub async fn wait_for_server() -> Result<u16, String> {
        let port = super::sidecar::PORT;
        let deadline = std::time::Instant::now() + Duration::from_secs(60);
        while std::time::Instant::now() < deadline {
            if super::sidecar::is_port_listening(port) {
                return Ok(port);
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        Err(format!(
            "Local server did not start within 60s on port {port}. Check %LOCALAPPDATA%/com.unfck.bandcamp/logs/ for sidecar stdout."
        ))
    }
}

mod tray {
    use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    use tauri::{AppHandle, Manager};
    use tauri_plugin_shell::ShellExt;

    /// Build the system-tray icon and its right-click menu. Left-click
    /// shows the main window; the menu offers Open / Open in Browser /
    /// Quit. We rely on the frontend (AppShell) to decide whether the
    /// X button hides the window into this tray — the Rust side just
    /// guarantees the tray exists when the window is gone.
    pub fn install(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
        let open_item = MenuItemBuilder::with_id("show", "Open Unfck Bandcamp").build(app)?;
        let browser_item =
            MenuItemBuilder::with_id("browser", "Open in browser").build(app)?;
        let quit_item = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
        let menu = MenuBuilder::new(app)
            .item(&open_item)
            .item(&browser_item)
            .item(&PredefinedMenuItem::separator(app)?)
            .item(&quit_item)
            .build()?;

        let icon = app
            .default_window_icon()
            .ok_or("default window icon missing")?
            .clone();

        TrayIconBuilder::with_id("main")
            .icon(icon)
            .tooltip("Unfck Bandcamp")
            .menu(&menu)
            .show_menu_on_left_click(false)
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
                {
                    show_main_window(tray.app_handle());
                }
            })
            .on_menu_event(|app, event| match event.id.as_ref() {
                "show" => show_main_window(app),
                "browser" => {
                    let url = format!("http://127.0.0.1:{}/", super::sidecar::PORT);
                    if let Err(e) = app.shell().open(&url, None) {
                        log::error!("tray: open in browser failed: {e}");
                    }
                }
                "quit" => {
                    log::info!("tray: quit selected");
                    app.exit(0);
                }
                _ => {}
            })
            .build(app)?;
        Ok(())
    }

    fn show_main_window(app: &AppHandle) {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.show();
            let _ = w.unminimize();
            let _ = w.set_focus();
        }
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

    /// Cheap TCP-connect probe to detect whether something is already
    /// listening on the loopback port. Used both as a stale-sidecar
    /// guard at startup (so we don't spawn a second Node that would
    /// die with EADDRINUSE) and as the readiness check the splash
    /// invokes via IPC.
    pub fn is_port_listening(port: u16) -> bool {
        use std::net::{SocketAddr, TcpStream};
        use std::time::Duration;
        let addr: SocketAddr = match format!("127.0.0.1:{}", port).parse() {
            Ok(a) => a,
            Err(_) => return false,
        };
        TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok()
    }

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
