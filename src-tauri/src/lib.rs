use tauri::Manager;

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
            commands::get_minimize_to_tray,
            commands::set_minimize_to_tray,
            commands::diagnose_updater,
            commands::log_from_frontend,
            commands::check_for_updates,
            commands::apply_update,
        ])
        .on_window_event(|window, event| {
            // Tray-on-close is decided in Rust because the JS-side
            // onCloseRequested listener wasn't reliably preventing the
            // close — empirically the window died before the async
            // handler could run preventDefault. Reading a tiny file
            // flag here is synchronous and runs inside the close-event
            // handler itself.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main"
                    && tray::should_minimize_to_tray(window.app_handle())
                {
                    api.prevent_close();
                    let _ = window.hide();
                }
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
    use url::Url;

    /// Spawns a child WebView at bandcamp.com/login, polls the URL until
    /// the user has signed in (post-login URL contains the user's
    /// username), then reads the session cookies and returns them so the
    /// setup wizard can pass them to /api/auth/validate.
    ///
    /// We intentionally keep cookie extraction on Tauri's native cookie
    /// APIs. On Tauri 2.11, `cookies_for_url` and `cookies` already
    /// delegate to the platform stores, including HTTP-only cookies, and
    /// Tauri documents Windows cookie reads as unsafe from synchronous
    /// commands / event handlers, so this command stays async.
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
                if s.starts_with("https://bandcamp.com/") {
                    if let Some(rest) = s.strip_prefix("https://bandcamp.com/") {
                        let candidate = rest
                            .split('/')
                            .next()
                            .unwrap_or("")
                            .split('?')
                            .next()
                            .unwrap_or("")
                            .trim();
                        if is_user_profile_segment(candidate) {
                            detected_username = Some(candidate.to_string());
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

        let cookie_string = if let Some(w) = app.get_webview_window(&label) {
            read_bandcamp_cookie_string(&w)?
        } else {
            return Err("Login window disappeared before cookies could be read.".into());
        };
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
    #[serde(rename_all = "camelCase")]
    pub struct LoginResult {
        // The frontend reads `result.cookieString` etc. (camelCase),
        // but Tauri's default serde serialization keeps Rust field
        // names verbatim, so the JSON we used to ship had snake_case
        // keys (`cookie_string`). The mismatch made the frontend's
        // `if (!result.cookieString)` always-truthy and the wizard
        // fell through to the "no cookies" branch even when the
        // Rust side returned a perfectly valid cookie string.
        pub cookie_string: String,
        pub fan_id: Option<u64>,
        pub username: Option<String>,
        pub role: String,
    }

    /// Read the authenticated Bandcamp cookies from the native webview
    /// cookie store after login completes.
    ///
    /// The implementation is compile-guarded so only the supported desktop
    /// targets for this app are built. Both paths currently use Tauri's
    /// stable cookie API, which is already backed by the native WebView2 /
    /// WKWebView cookie managers listed above.
    #[cfg(target_os = "windows")]
    fn read_bandcamp_cookie_string(
        window: &tauri::WebviewWindow,
    ) -> Result<String, String> {
        collect_bandcamp_cookie_string(window)
    }

    /// Read the authenticated Bandcamp cookies from the native webview
    /// cookie store after login completes.
    #[cfg(target_os = "macos")]
    fn read_bandcamp_cookie_string(
        window: &tauri::WebviewWindow,
    ) -> Result<String, String> {
        collect_bandcamp_cookie_string(window)
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    fn read_bandcamp_cookie_string(
        _window: &tauri::WebviewWindow,
    ) -> Result<String, String> {
        Err("Bandcamp cookie extraction is only implemented for Windows and macOS.".into())
    }

    fn collect_bandcamp_cookie_string(
        window: &tauri::WebviewWindow,
    ) -> Result<String, String> {
        let (cookies, source_was_url_filtered) = read_bandcamp_cookies(window)?;

        // When read_bandcamp_cookies returned a URL-filtered list,
        // every cookie is already known to apply to bandcamp.com — the
        // tauri runtime did the matching already. Re-filtering by
        // cookie.domain() then drops anything whose Set-Cookie header
        // didn't include an explicit Domain= directive (which on
        // Bandcamp includes `identity` and `js_logged_in`, the only two
        // cookies that actually matter here). The extra domain filter
        // only kicks in for the unfiltered fallback path
        // (`window.cookies()`), where it's still load-bearing.
        let mut pairs: Vec<(u8, String)> = cookies
            .into_iter()
            .filter(|cookie| {
                if source_was_url_filtered {
                    return true;
                }
                cookie
                    .domain()
                    .map(is_bandcamp_cookie_domain)
                    .unwrap_or(false)
            })
            .map(|cookie| {
                let priority = match cookie.name() {
                    "identity" => 0,
                    "session" => 1,
                    _ => 2,
                };
                (priority, format!("{}={}", cookie.name(), cookie.value()))
            })
            .collect();

        pairs.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));

        Ok(pairs
            .into_iter()
            .map(|(_, pair)| pair)
            .collect::<Vec<_>>()
            .join("; "))
    }

    fn read_bandcamp_cookies(
        window: &tauri::WebviewWindow,
    ) -> Result<(Vec<tauri::webview::Cookie<'static>>, bool), String> {
        log::info!(
            "[cookie-diag] reading cookies from window label={} url={:?}",
            window.label(),
            window.url().ok().map(|u| u.to_string())
        );

        // Prefer window.cookies() over cookies_for_url(): WebView2's
        // GetCookies(uri) is matched against the request URI, which
        // strips out cookies whose `Domain=` attribute targets a
        // different host than the bare URL we ask for. Bandcamp sets
        // `identity` and `js_logged_in` with Domain=.bandcamp.com on
        // a Set-Cookie response that flows during the popup-login
        // round-trip, so cookies_for_url("https://bandcamp.com/")
        // returned 15 cookies (csrf_token, session, fan_visits,
        // tracking junk) but neither of the two markers
        // validateCookies() actually requires.
        //
        // window.cookies() returns the full webview cookie store, which
        // we then filter by domain ourselves — that picks up cookies
        // set on .bandcamp.com or any *.bandcamp.com subdomain too.
        match window.cookies() {
            Ok(cookies) => {
                let names: Vec<&str> = cookies.iter().map(|c| c.name()).collect();
                let domains: Vec<Option<&str>> =
                    cookies.iter().map(|c| c.domain()).collect();
                log::info!(
                    "[cookie-diag] window.cookies() returned {} cookies: names={:?} domains={:?}",
                    cookies.len(),
                    names,
                    domains
                );
                if !cookies.is_empty() {
                    return Ok((cookies, false));
                }
            }
            Err(e) => {
                log::warn!("[cookie-diag] window.cookies() errored: {}", e);
            }
        }

        // Fallback path for setups where window.cookies() returns
        // nothing. This was the original v2.4.18 implementation —
        // keep it as a safety net but it's rarely hit in practice.
        for url in ["https://bandcamp.com/", "https://www.bandcamp.com/"] {
            let parsed = Url::parse(url)
                .map_err(|e| format!("failed to build Bandcamp cookie URL: {e}"))?;
            match window.cookies_for_url(parsed) {
                Ok(cookies) => {
                    let names: Vec<&str> = cookies.iter().map(|c| c.name()).collect();
                    log::info!(
                        "[cookie-diag] cookies_for_url({}) returned {} cookies: {:?}",
                        url,
                        cookies.len(),
                        names
                    );
                    if !cookies.is_empty() {
                        return Ok((cookies, true));
                    }
                }
                Err(e) => {
                    log::warn!("[cookie-diag] cookies_for_url({}) errored: {}", url, e);
                }
            }
        }

        Err("no cookies found in webview".into())
    }

    fn is_bandcamp_cookie_domain(domain: &str) -> bool {
        let domain = domain.trim_start_matches('.');
        domain == "bandcamp.com" || domain.ends_with(".bandcamp.com")
    }

    /// Whether `bandcamp.com/<segment>` looks like a fan profile URL
    /// (i.e. the user has actually signed in and Bandcamp is showing
    /// them their own page) versus one of the many top-level routes
    /// Bandcamp also serves under the same prefix. Earlier versions
    /// of this command treated anything that wasn't `/login`,
    /// `/signup`, or `/forgot` as "the user just logged in", which
    /// meant `/discover`, `/logout`, `/album/...`, etc. were all
    /// reported as the username — the cookie read then ran on a
    /// session that didn't belong to a logged-in fan.
    ///
    /// Bandcamp usernames are alphanumeric + underscore; everything
    /// else here is a reserved app route. We allow `_` and digits to
    /// avoid rejecting valid usernames like `dj_2pac`.
    fn is_user_profile_segment(segment: &str) -> bool {
        if segment.is_empty() {
            return false;
        }
        const RESERVED: &[&str] = &[
            "login", "signup", "forgot", "logout",
            "discover", "feed", "search", "tag", "tags",
            "album", "track", "merch", "subdomain",
            "artists", "labels", "fan", "mobile",
            "api", "static", "img", "help", "terms",
            "privacy", "about", "campaign", "pro",
            "tools", "settings",
        ];
        if RESERVED.contains(&segment) {
            return false;
        }
        segment
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    }

    /// Returns whether the user has opted in to "X minimizes to tray".
    /// State lives in a one-byte flag file under app_data_dir so the
    /// close-event handler can read it synchronously without an IPC
    /// round-trip.
    #[tauri::command]
    pub fn get_minimize_to_tray(app: AppHandle) -> bool {
        super::tray::should_minimize_to_tray(&app)
    }

    /// Persist the tray-on-close preference. Called from /setup when
    /// the user toggles the checkbox.
    #[tauri::command]
    pub fn set_minimize_to_tray(app: AppHandle, value: bool) -> Result<(), String> {
        super::tray::set_minimize_to_tray(&app, value).map_err(|e| e.to_string())
    }

    /// Diagnostic: invoke the updater plugin's check() directly from
    /// Rust, bypassing the frontend ACL layer. If this works while
    /// `__TAURI_INTERNALS__.invoke('plugin:updater|check')` from the
    /// frontend fails with "not allowed by ACL", we know the plugin
    /// itself is fine and the bug is in the capability registration
    /// or window-resolution layer that the frontend invoke goes
    /// through.
    #[tauri::command]
    pub async fn diagnose_updater(app: AppHandle) -> Result<String, String> {
        use tauri_plugin_updater::UpdaterExt;
        log::info!("[updater-diag] starting direct Rust-side updater.check()");
        let updater = match app.updater() {
            Ok(u) => u,
            Err(e) => {
                let msg = format!("updater() builder failed: {e}");
                log::error!("[updater-diag] {msg}");
                return Err(msg);
            }
        };
        match updater.check().await {
            Ok(Some(update)) => {
                let msg = format!(
                    "update available: version={} current={}",
                    update.version, update.current_version
                );
                log::info!("[updater-diag] {msg}");
                Ok(msg)
            }
            Ok(None) => {
                log::info!("[updater-diag] no update available (latest already installed)");
                Ok("no update available".into())
            }
            Err(e) => {
                let msg = format!("check() errored: {e}");
                log::error!("[updater-diag] {msg}");
                Err(msg)
            }
        }
    }

    #[derive(serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct UpdateInfo {
        pub version: String,
        pub current_version: String,
        pub notes: Option<String>,
        pub date: Option<String>,
    }

    /// Direct Rust-side updater check that the frontend can invoke
    /// via a custom command. v2.4.18's diagnose_updater confirmed
    /// that `app.updater().check()` works fine from Rust, while
    /// the same call routed through `plugin:updater|check` from the
    /// frontend keeps getting rejected by the ACL layer with
    /// "Command plugin:updater|check not allowed by ACL", even
    /// though every documented capability permission is present.
    /// Wrapping the plugin in our own command bypasses the ACL
    /// path that's broken, so updates work again.
    #[tauri::command]
    pub async fn check_for_updates(
        app: AppHandle,
    ) -> Result<Option<UpdateInfo>, String> {
        use tauri_plugin_updater::UpdaterExt;
        let updater = app.updater().map_err(|e| e.to_string())?;
        match updater.check().await {
            Ok(Some(update)) => Ok(Some(UpdateInfo {
                version: update.version.clone(),
                current_version: update.current_version.clone(),
                notes: update.body.clone(),
                date: update.date.map(|d| d.to_string()),
            })),
            Ok(None) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    /// Same idea: download + install + relaunch as a single custom
    /// command, so the frontend never has to touch the
    /// plugin:updater|download_and_install or plugin:process|restart
    /// IPC paths that the same ACL layer rejects.
    ///
    /// Before triggering the restart we explicitly kill the bundled
    /// Node sidecar. Tauri's `app.restart()` only terminates its own
    /// main process; child processes spawned via the shell plugin
    /// keep running across the restart. The NSIS installer then can't
    /// overwrite better_sqlite3.node (still locked by the live Node
    /// process) and bails out with "Error opening file for writing"
    /// — Marco hit that during the v2.4.21 update and had to click
    /// "Ignore" to push through.
    #[tauri::command]
    pub async fn apply_update(app: AppHandle) -> Result<(), String> {
        use tauri_plugin_updater::UpdaterExt;
        let updater = app.updater().map_err(|e| e.to_string())?;
        let update = updater
            .check()
            .await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "no update available".to_string())?;
        update
            .download_and_install(|_chunk_length, _content_length| {}, || {})
            .await
            .map_err(|e| e.to_string())?;
        if let Some(handle) = app.try_state::<super::sidecar::SidecarHandle>() {
            super::sidecar::kill(&handle);
            // Give Windows a moment to release the file lock before
            // the installer (about to be triggered by app.restart())
            // tries to overwrite the standalone tree.
            tokio::time::sleep(std::time::Duration::from_millis(800)).await;
        }
        app.restart();
    }

    /// Diagnostic: pipe a frontend log line into the Tauri log file so
    /// the developer can read the user's diagnostic output without
    /// asking them to open DevTools and paste the console.
    #[tauri::command]
    pub fn log_from_frontend(level: String, message: String) {
        match level.as_str() {
            "error" => log::error!("[frontend] {message}"),
            "warn" => log::warn!("[frontend] {message}"),
            _ => log::info!("[frontend] {message}"),
        }
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

    /// File-backed flag for "X minimizes to tray". The close-event
    /// handler reads this synchronously, so we keep the on-disk format
    /// trivially simple: the file's existence means "on", absent means
    /// "off". No JSON, no parsing, no migration.
    fn flag_path(app: &AppHandle) -> Result<std::path::PathBuf, Box<dyn std::error::Error>> {
        let dir = app.path().app_data_dir()?;
        std::fs::create_dir_all(&dir).ok();
        Ok(dir.join("minimize_to_tray.flag"))
    }

    pub fn should_minimize_to_tray(app: &AppHandle) -> bool {
        match flag_path(app) {
            Ok(p) => p.exists(),
            Err(_) => false,
        }
    }

    pub fn set_minimize_to_tray(
        app: &AppHandle,
        value: bool,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let path = flag_path(app)?;
        if value {
            std::fs::write(&path, b"on")?;
        } else if path.exists() {
            std::fs::remove_file(&path)?;
        }
        Ok(())
    }
}

mod sidecar {
    use std::path::{Path, PathBuf};
    use std::sync::Mutex;
    use tauri::{AppHandle, Manager};
    use tauri_plugin_shell::process::{CommandChild, CommandEvent};

    /// App-state container for the spawned Next.js sidecar process so
    /// other commands (notably apply_update) can terminate it before
    /// Tauri's own restart kicks in. The NSIS installer fails with
    /// "Error opening file for writing" on better_sqlite3.node when
    /// the Node process is still holding the .node binary, and Tauri
    /// only kills its own main process on restart — not children
    /// spawned via the shell plugin.
    pub struct SidecarHandle(pub Mutex<Option<CommandChild>>);

    pub fn kill(handle: &SidecarHandle) {
        if let Ok(mut guard) = handle.0.lock() {
            if let Some(child) = guard.take() {
                let _ = child.kill();
            }
        }
    }
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
        // .app_secret holds the AES-256-GCM key for the auth-cookie
        // column. It used to default to <cwd>/data/.app_secret, where
        // <cwd> = standalone tree under the program-files install
        // dir — that gets wiped on every NSIS uninstall, taking the
        // key with it and rendering the surviving auth rows in the
        // user-data DB undecryptable. Pinning the path next to the
        // DB itself (in app_data_dir, which the uninstaller leaves
        // alone unless the user explicitly opts in) keeps logins
        // surviving reinstalls.
        let secret_path_str = data_dir.join(".app_secret").to_string_lossy().to_string();
        // CWD must be the standalone tree itself: server.js does
        // `require('./.next/server/...')` style relative loads, which
        // only resolve correctly when Node is running with that
        // directory as its working directory.
        let (mut rx, child) = app
            .shell()
            .sidecar("node")?
            .args(["server.js"])
            .current_dir(standalone_dir.clone())
            .env("PORT", PORT.to_string())
            .env("HOSTNAME", "127.0.0.1")
            .env("DATABASE_PATH", db_path_str)
            .env("UNFCK_DATA_DIR", data_dir_str)
            .env("UNFCK_SECRET_PATH", secret_path_str)
            .spawn()?;
        // Keep the child handle in app state so apply_update can kill
        // the sidecar before triggering a restart — otherwise the
        // Node process keeps better_sqlite3.node locked and the NSIS
        // installer aborts with "Error opening file for writing".
        app.manage(SidecarHandle(Mutex::new(Some(child))));

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
