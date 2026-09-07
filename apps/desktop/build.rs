fn main() {
    println!("cargo:rerun-if-env-changed=AI_WORKSPACE_DESKTOP_URL");
    tauri_build::build()
}
