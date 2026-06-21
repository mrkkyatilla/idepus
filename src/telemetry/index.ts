const STORAGE_KEY = "idepus.telemetry.enabled";

export type TelemetryConfig = {
  enabled: boolean;
};

export type TelemetryEvent = {
  name: string;
  ts: number;
  props?: Record<string, string | number | boolean>;
};

export function loadTelemetryConfig(): TelemetryConfig {
  return {
    enabled: localStorage.getItem(STORAGE_KEY) === "true",
  };
}

export function saveTelemetryConfig(config: TelemetryConfig): void {
  localStorage.setItem(STORAGE_KEY, config.enabled ? "true" : "false");
}

async function writeEvent(event: TelemetryEvent): Promise<void> {
  const config = loadTelemetryConfig();
  if (!config.enabled) {
    return;
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("telemetry_log_event", { event });
  } catch {
    console.info("[telemetry]", event.name, event.props ?? {});
  }
}

export function trackAppStart(coldStartMs?: number): void {
  void writeEvent({
    name: "app_start",
    ts: Date.now(),
    props: coldStartMs !== undefined ? { cold_start_ms: coldStartMs } : undefined,
  });
}

export function trackFeatureUsed(feature: string): void {
  void writeEvent({ name: "feature_used", ts: Date.now(), props: { feature } });
}

export function trackError(count = 1): void {
  void writeEvent({ name: "error_count", ts: Date.now(), props: { count } });
}

export function initTelemetry(): void {
  const started = performance.now();
  window.addEventListener("load", () => {
    trackAppStart(Math.round(performance.now() - started));
  });
}
