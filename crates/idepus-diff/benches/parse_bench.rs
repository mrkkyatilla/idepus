use criterion::{black_box, criterion_group, criterion_main, Criterion};
use idepus_diff::{apply_hunks, resolve_patch, PatchHunk};

fn bench_resolve_patch(c: &mut Criterion) {
    let content = "fn main() {\n    println!(\"hello\");\n}\n";
    let raw = r#"```diff
<<<<<<< SEARCH
    println!("hello");
=======
    println!("world");
>>>>>>> REPLACE
```"#;
    c.bench_function("resolve_patch", |b| {
        b.iter(|| {
            black_box(resolve_patch(raw, "main.rs", content).unwrap());
        });
    });
}

fn bench_apply_hunks(c: &mut Criterion) {
    let content = "fn main() {\n    println!(\"hello\");\n}\n";
    let hunk = PatchHunk {
        id: "h1".into(),
        start_byte: 15,
        end_byte: 35,
        start_line: 2,
        end_line: 2,
        search_text: "    println!(\"hello\");".into(),
        replace_text: "    println!(\"world\");".into(),
    };
    c.bench_function("apply_hunks", |b| {
        b.iter(|| {
            black_box(apply_hunks(content, &[hunk.clone()], &["h1".into()]).unwrap());
        });
    });
}

criterion_group!(benches, bench_resolve_patch, bench_apply_hunks);
criterion_main!(benches);
