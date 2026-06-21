const STORAGE_URL = "idepus.aicery.runtime_url";
const STORAGE_KEY = "idepus.aicery.api_key";

export type AiceryConfig = {
  runtime_url: string;
  api_key: string;
};

export type AicerySidecarStatus = {
  ok: boolean;
  url: string;
  agents: string[];
  message: string;
};

export type BridgeInfo = {
  url: string;
  token: string;
};

const DEFAULT_CONFIG: AiceryConfig = {
  runtime_url: "http://localhost:8000",
  api_key: "dev",
};

export function loadAiceryConfig(): AiceryConfig {
  return {
    runtime_url: localStorage.getItem(STORAGE_URL) ?? DEFAULT_CONFIG.runtime_url,
    api_key: localStorage.getItem(STORAGE_KEY) ?? DEFAULT_CONFIG.api_key,
  };
}

export function saveAiceryConfig(config: Partial<AiceryConfig>): AiceryConfig {
  const current = loadAiceryConfig();
  const next = { ...current, ...config };
  localStorage.setItem(STORAGE_URL, next.runtime_url);
  localStorage.setItem(STORAGE_KEY, next.api_key);
  return next;
}

export async function fetchSidecarStatus(
  config: AiceryConfig = loadAiceryConfig(),
): Promise<AicerySidecarStatus> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AicerySidecarStatus>("aicery_sidecar_status", {
    runtimeUrl: config.runtime_url,
    apiKey: config.api_key,
  });
}

export async function fetchBridgeInfo(): Promise<BridgeInfo> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<BridgeInfo>("get_bridge_info");
}
