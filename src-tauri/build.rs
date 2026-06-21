fn main() {
    let protoc = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../.tools/protoc/bin/protoc");
    if protoc.exists() {
        std::env::set_var("PROTOC", protoc);
    }
    tauri_build::build()
}
