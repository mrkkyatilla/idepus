# Plugins

idepus loads unsigned dylibs from:

- `~/.config/idepus/plugins/*.so`
- `{workspace}/.idepus/plugins/*.so`

## Building the gitignore example

```bash
cargo build -p idepus-plugin-gitignore --release
cp target/release/libidepus_plugin_gitignore.so ~/.config/idepus/plugins/
```

Restart idepus or invoke `load_plugins`. `@gitignore` suggestions appear in mention autocomplete.

## API

See `crates/idepus-plugin-api/src/lib.rs` for `ContextSource` and `AgentTool` traits.

Export `idepus_plugin_entry`, `idepus_plugin_suggest`, and `idepus_plugin_free_string` from your dylib.

**Security:** dylibs run with host process privileges. Only install plugins you trust.
