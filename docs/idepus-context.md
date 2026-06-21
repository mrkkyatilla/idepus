# Team context

Place `.idepus-context` (YAML) or `.idepus-context.json` at the workspace root.

```yaml
architecture:
  - "No global mutable state"
protected_patterns:
  - "src/core/**"
preferred_libraries:
  - "serde"
```

Protected patterns are enforced in the patch queue UI (`protected-check.ts`).

See `examples/.idepus-context`.
