import { invoke } from "@tauri-apps/api/core";

export type ResearchProvider = "mock" | "tavily";

export type ResearchConfigView = {
  enabled: boolean;
  provider: ResearchProvider;
  blocked_domains: string[];
  allowed_domains: string[];
  max_parallel_runs: number;
  has_api_key: boolean;
};

export type ResearchTestResult = {
  ok: boolean;
  message: string;
  result_count: number;
};

export async function getResearchConfig(): Promise<ResearchConfigView> {
  return invoke<ResearchConfigView>("get_research_config");
}

export async function saveResearchConfig(config: {
  enabled: boolean;
  provider: ResearchProvider;
  blocked_domains?: string[];
  allowed_domains?: string[];
  max_parallel_runs?: number;
}): Promise<void> {
  await invoke("save_research_config_cmd", {
    request: {
      enabled: config.enabled,
      provider: config.provider,
      blocked_domains: config.blocked_domains ?? [],
      allowed_domains: config.allowed_domains ?? [],
      max_parallel_runs: config.max_parallel_runs ?? 3,
    },
  });
}

export async function saveResearchApiKey(apiKey: string): Promise<void> {
  await invoke("save_research_api_key", { apiKey });
}

export async function deleteResearchApiKey(): Promise<void> {
  await invoke("delete_research_api_key_cmd");
}

export async function testResearchConnection(): Promise<ResearchTestResult> {
  return invoke<ResearchTestResult>("test_research_connection");
}

export async function getMaxParallelRuns(): Promise<number> {
  const config = await getResearchConfig();
  return Math.min(3, Math.max(1, config.max_parallel_runs || 3));
}
