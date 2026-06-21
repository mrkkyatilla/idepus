# AI workflow config

Place `ai-workflow.yaml` at the workspace root.

```yaml
version: 1
overrides:
  - when:
      task: refactor
    agent_id: multi-file-editor
    provider: openai
```

Routing is applied in `src/agent/routing.ts` when launching agent tasks.

See `examples/ai-workflow.yaml` for a starter file.
