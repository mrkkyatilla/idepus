use criterion::{black_box, criterion_group, criterion_main, Criterion};
use std::fs;
use tempfile::tempdir;

fn bench_prepare_tree(c: &mut Criterion) {
    let tmp = tempdir().expect("tempdir");
    let workspace = tmp.path().join("ws");
    let src = workspace.join("src");
    fs::create_dir_all(&src).unwrap();
    fs::write(src.join("main.rs"), "fn main() {}\n").unwrap();
    fs::write(workspace.join("Cargo.toml"), "[package]\nname = \"demo\"\n").unwrap();

    let shadow = tmp.path().join("shadow");
    c.bench_function("prepare_tree", |b| {
        b.iter(|| {
            let _ = fs::remove_dir_all(&shadow);
            black_box(idepus_lib::shadow_prepare_tree_bench(&workspace, &shadow).unwrap());
        });
    });
}

criterion_group!(benches, bench_prepare_tree);
criterion_main!(benches);
