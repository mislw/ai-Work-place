#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    fs::OpenOptions,
    io::Write,
    net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Arc,
    thread,
    time::{Duration, Instant},
};

use personal_ai_workspace_desktop::{
    DesktopConfig, NavigationDecision, connectivity::ConnectivityState,
};
use reqwest::Client;
use tauri::{Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, webview::PageLoadEvent};
use url::Url;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const DEFAULT_WORKSPACE_URL: &str = "https://ai.mislw.cn";
const LOCAL_STATUS_URL: &str = "tauri://localhost/";
const HEALTH_TIMEOUT: Duration = Duration::from_secs(5);
const HEALTH_INTERVAL: Duration = Duration::from_secs(5);
const HELPER_START_TIMEOUT: Duration = Duration::from_secs(30);
const HELPER_RESTART_DELAY: Duration = Duration::from_secs(1);
const LOCAL_TOOLBOX_PORT: u16 = 37654;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn main() {
    let workspace_url = option_env!("AI_WORKSPACE_DESKTOP_URL").unwrap_or(DEFAULT_WORKSPACE_URL);
    let config = DesktopConfig::from_workspace_url(workspace_url)
        .unwrap_or_else(|error| panic!("invalid desktop workspace URL: {error}"));
    let config = Arc::new(config);

    tauri::Builder::default()
        .setup(move |app| {
            let helper_paths = local_toolbox_paths(app.path().resource_dir()?)?;
            let helper_port = reserve_loopback_port()?;
            let helper_origin = Url::parse(&format!("http://127.0.0.1:{helper_port}"))
                .expect("fixed loopback origin must parse");

            log_toolbox(format!(
                "starting port={helper_port} node={} helper={}",
                helper_paths.0.display(),
                helper_paths.1.display()
            ));
            let helper_child = start_local_toolbox(&helper_paths, helper_port)?;
            log_toolbox(format!("spawned pid={}", helper_child.id()));
            wait_for_loopback(helper_port, HELPER_START_TIMEOUT)?;
            log_toolbox("ready".to_string());
            spawn_local_toolbox_supervisor(helper_paths, helper_port, helper_child);

            let workspace_origin = config.workspace_url().origin().ascii_serialization();
            let initialization_script =
                toolbox_initialization_script(&workspace_origin, helper_origin.as_str());
            let page_load_origin = workspace_origin.clone();
            let page_load_script = initialization_script.clone();
            let navigation_config = Arc::clone(&config);
            let navigation_toolbox = helper_origin.clone();
            let navigation_handle = app.handle().clone();
            let new_window_config = Arc::clone(&config);
            let new_window_toolbox = helper_origin.clone();
            let new_window_handle = app.handle().clone();
            let window =
                WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                    .title("Personal AI Workspace")
                    .inner_size(1360.0, 880.0)
                    .min_inner_size(960.0, 640.0)
                    .center()
                    .initialization_script(initialization_script)
                    .on_page_load(move |window, payload| {
                        if payload.event() == PageLoadEvent::Finished
                            && payload.url().origin().ascii_serialization() == page_load_origin
                        {
                            let script = format!(
                                r#"{page_load_script}
const retryButton = Array.from(document.querySelectorAll("button")).find(
  (button) => button.textContent?.includes("重试连接"),
);
if (retryButton instanceof HTMLButtonElement) retryButton.click();"#,
                            );
                            let _ = window.eval(script);
                        }
                    })
                    .on_navigation(move |target| {
                        if is_local_status_url(target) {
                            return true;
                        }

                        match navigation_config
                            .classify_navigation_with_toolbox(target, &navigation_toolbox)
                        {
                            NavigationDecision::Internal => true,
                            NavigationDecision::External => {
                                let _ = opener::open_browser(target.as_str());
                                false
                            }
                            NavigationDecision::LocalToolbox => {
                                open_local_toolbox_window(&navigation_handle, target.clone());
                                false
                            }
                            NavigationDecision::Blocked => false,
                        }
                    })
                    .on_new_window(move |target, _features| {
                        match new_window_config
                            .classify_navigation_with_toolbox(&target, &new_window_toolbox)
                        {
                            NavigationDecision::Internal | NavigationDecision::External => {
                                let _ = opener::open_browser(target.as_str());
                            }
                            NavigationDecision::LocalToolbox => {
                                open_local_toolbox_window(&new_window_handle, target);
                            }
                            NavigationDecision::Blocked => {}
                        }
                        tauri::webview::NewWindowResponse::Deny
                    })
                    .build()?;

            spawn_connectivity_monitor(window, Arc::clone(&config));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run Personal AI Workspace desktop client");
}

fn local_toolbox_paths(resource_dir: PathBuf) -> Result<(PathBuf, PathBuf, PathBuf), std::io::Error> {
    let root = node_compatible_path(resource_dir)
        .join("resources")
        .join("local-toolbox");
    let node = root.join("node.exe");
    let helper = root.join("helper.mjs");
    let seven_zip = root.join("7za.exe");
    if !node.is_file() || !helper.is_file() || !seven_zip.is_file() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "bundled local toolbox runtime is missing",
        ));
    }
    Ok((node, helper, seven_zip))
}

fn node_compatible_path(path: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        let value = path.to_string_lossy();
        if let Some(unc) = value.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{unc}"));
        }
        if let Some(ordinary) = value.strip_prefix(r"\\?\") {
            return PathBuf::from(ordinary);
        }
    }
    path
}

fn toolbox_initialization_script(workspace_origin: &str, helper_origin: &str) -> String {
    format!(
        r#"if (window.location.origin === {workspace_origin:?}) {{
  const dynamicOrigin = {helper_origin:?};
  const legacyOrigin = "http://127.0.0.1:37654";
  window.__PERSONAL_AI_WORKSPACE_LOCAL_TOOLBOX_ORIGIN__ = dynamicOrigin;

  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {{
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(legacyOrigin)) {{
      return nativeFetch(dynamicOrigin + url.slice(legacyOrigin.length), init);
    }}
    return nativeFetch(input, init);
  }};

  const nativeOpen = window.open.bind(window);
  window.open = (url, target, features) => {{
    const value = url == null ? "" : String(url);
    return nativeOpen(
      value.startsWith(legacyOrigin)
        ? dynamicOrigin + value.slice(legacyOrigin.length)
        : value,
      target,
      features,
    );
  }};
}}"#,
    )
}

fn reserve_loopback_port() -> Result<u16, std::io::Error> {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match TcpListener::bind((Ipv4Addr::LOCALHOST, LOCAL_TOOLBOX_PORT)) {
            Ok(listener) => {
                drop(listener);
                return Ok(LOCAL_TOOLBOX_PORT);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AddrInUse => {
                if Instant::now() >= deadline {
                    return Err(error);
                }
                thread::sleep(Duration::from_millis(200));
            }
            Err(error) => return Err(error),
        }
    }
}

fn start_local_toolbox(
    paths: &(PathBuf, PathBuf, PathBuf),
    port: u16,
) -> Result<Child, std::io::Error> {
    let mut command = Command::new(&paths.0);
    command
        .arg(&paths.1)
        .arg("--embedded")
        .arg("--port")
        .arg(port.to_string())
        .arg("--parent-pid")
        .arg(std::process::id().to_string())
        .env("LOCAL_TOOLBOX_ORIGIN", format!("http://127.0.0.1:{port}"))
        .env("LOCAL_TOOLBOX_7ZIP_PATH", &paths.2)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command.spawn()
}

fn spawn_local_toolbox_supervisor(
    paths: (PathBuf, PathBuf, PathBuf),
    port: u16,
    initial_child: Child,
) {
    thread::spawn(move || {
        let mut child = initial_child;
        loop {
            match child.wait() {
                Ok(status) => log_toolbox(format!("exited status={status}")),
                Err(error) => log_toolbox(format!("wait failed error={error}")),
            }
            thread::sleep(HELPER_RESTART_DELAY);
            child = loop {
                match start_local_toolbox(&paths, port) {
                    Ok(child) => {
                        log_toolbox(format!("restarted pid={}", child.id()));
                        break child;
                    }
                    Err(error) => {
                        log_toolbox(format!("restart failed error={error}"));
                        thread::sleep(HELPER_RESTART_DELAY);
                    }
                }
            };
        }
    });
}

fn log_toolbox(message: String) {
    let path = std::env::temp_dir().join("personal-ai-workspace-toolbox.log");
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{message}");
    }
}

fn wait_for_loopback(port: u16, timeout: Duration) -> Result<(), std::io::Error> {
    let deadline = Instant::now() + timeout;
    let address = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port);
    while Instant::now() < deadline {
        if TcpStream::connect_timeout(&address, Duration::from_millis(200)).is_ok() {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(100));
    }
    Err(std::io::Error::new(
        std::io::ErrorKind::TimedOut,
        "bundled local toolbox did not start",
    ))
}

fn open_local_toolbox_window(app: &tauri::AppHandle, target: Url) {
    if let Some(window) = app.get_webview_window("local-toolbox") {
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }

    let toolbox_origin = target.clone();
    let _ = WebviewWindowBuilder::new(app, "local-toolbox", WebviewUrl::External(target))
        .title("解压小工具")
        .inner_size(860.0, 720.0)
        .min_inner_size(720.0, 560.0)
        .center()
        .on_navigation(move |navigation| navigation.origin() == toolbox_origin.origin())
        .build();
}

fn is_local_status_url(target: &Url) -> bool {
    target.scheme() == "tauri" || target.host_str() == Some("tauri.localhost")
}

fn spawn_connectivity_monitor(window: WebviewWindow, config: Arc<DesktopConfig>) {
    tauri::async_runtime::spawn(async move {
        let client = Client::builder()
            .timeout(HEALTH_TIMEOUT)
            .build()
            .expect("health-check HTTP client must build");
        let local_status_url = Url::parse(LOCAL_STATUS_URL).expect("fixed local URL must parse");
        let mut last_state = None;

        loop {
            let status = client
                .get(config.health_url())
                .send()
                .await
                .map(|response| response.status())
                .map_err(|_| ());
            let state = ConnectivityState::from_status(status);

            if last_state != Some(state) {
                let target = match state {
                    ConnectivityState::Online => config.workspace_url().clone(),
                    ConnectivityState::Offline => local_status_url.clone(),
                };
                let _ = window.navigate(target);
                last_state = Some(state);
            }

            tokio::time::sleep(HEALTH_INTERVAL).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{LOCAL_TOOLBOX_PORT, node_compatible_path, toolbox_initialization_script};
    use std::path::PathBuf;

    #[test]
    fn removes_windows_verbatim_prefix_before_passing_paths_to_node() {
        assert_eq!(
            node_compatible_path(PathBuf::from(
                r"\\?\D:\app\resources\local-toolbox\helper.mjs",
            )),
            PathBuf::from(r"D:\app\resources\local-toolbox\helper.mjs"),
        );
    }

    #[test]
    fn redirects_only_the_legacy_toolbox_origin_to_the_dynamic_origin() {
        let script = toolbox_initialization_script("https://ai.mislw.cn", "http://127.0.0.1:49152");

        assert!(script.contains("http://127.0.0.1:37654"));
        assert!(script.contains("http://127.0.0.1:49152"));
        assert!(script.contains("window.fetch"));
        assert!(script.contains("window.open"));
        assert!(script.contains("startsWith(legacyOrigin)"));
    }

    #[test]
    fn desktop_manages_the_workspace_compatible_toolbox_port() {
        assert_eq!(LOCAL_TOOLBOX_PORT, 37654);
    }
}
