use std::fs;
use std::path::Path;

/// Dev/test convenience. `bundle.externalBin` + `bundle.resources` in
/// tauri.conf.json name files produced by `npm run sidecar:package` (packaging
/// staging, gitignored — see scripts/stage-sidecar-runtime.sh), and
/// tauri-build refuses to run when they are missing. That would break bare
/// `cargo test` / `tauri dev` on a fresh clone, so debug builds get empty
/// placeholders. Dev never executes them (the debug sidecar spawn runs from
/// the repo's sidecar/ source); release builds create nothing here and still
/// fail loudly if real staging didn't run first (`npm run tauri build`'s
/// beforeBuildCommand runs it).
fn ensure_dev_placeholders() {
    if std::env::var("PROFILE").as_deref() != Ok("debug") {
        return;
    }
    let target = std::env::var("TARGET").expect("cargo always sets TARGET");
    for rel in [
        format!("binaries/node-{target}"),
        format!("binaries/claude-{target}"),
        "resources/sidecar/sidecar-bundle.mjs".to_string(),
    ] {
        let path = Path::new(&rel);
        if !path.exists() {
            if let Some(parent) = path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            let _ = fs::File::create(path);
        }
    }
}

fn main() {
    ensure_dev_placeholders();
    tauri_build::build()
}
