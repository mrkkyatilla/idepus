import type { ContextHits } from "./types";

export function trackMemoryRetrieval(hits: ContextHits): void {
  const memoryCount = hits.memories?.length ?? 0;
  const changeCount = hits.changes?.length ?? 0;
  if (memoryCount === 0 && changeCount === 0) {
    return;
  }
  void import("../telemetry").then(({ trackFeatureUsed }) => {
    trackFeatureUsed("memory_retrieval");
    void import("@tauri-apps/api/core").then(({ invoke }) => {
      void invoke("telemetry_log_event", {
        event: {
          name: "memory_retrieval",
          ts: Date.now(),
          props: {
            memory_hit_count: memoryCount,
            change_hit_count: changeCount,
            memory_types: (hits.memories ?? [])
              .map((m) => m.type)
              .join(","),
          },
        },
      }).catch(() => {});
    });
  });
}
