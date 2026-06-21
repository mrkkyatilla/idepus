import { invoke } from "@tauri-apps/api/core";

export type AutocompleteProvider = "mock" | "ollama";

export type AutocompleteConfig = {
  enabled: boolean;
  provider: AutocompleteProvider;
  debounce_ms: number;
  model: string;
};

export type AutocompleteSuggestion = {
  text: string;
  model: string;
  latency_ms: number;
};

export type OllamaHealth = {
  available: boolean;
  models: string[];
  gpu_detected: boolean;
  message: string;
};

export async function getAutocompleteConfig(): Promise<AutocompleteConfig> {
  return invoke<AutocompleteConfig>("get_autocomplete_config");
}

export async function saveAutocompleteConfig(config: {
  enabled: boolean;
  provider: AutocompleteProvider;
  debounce_ms?: number;
  model?: string;
}): Promise<void> {
  await invoke("save_autocomplete_config_cmd", { request: config });
}

export async function autocompleteSuggest(request: {
  prefix: string;
  suffix: string;
  file_path: string;
  language: string;
  cursor_offset: number;
}): Promise<AutocompleteSuggestion | null> {
  return invoke<AutocompleteSuggestion | null>("autocomplete_suggest", {
    request,
  });
}

export async function ollamaHealthCheck(): Promise<OllamaHealth> {
  return invoke<OllamaHealth>("ollama_health_check");
}

export async function ollamaPullModel(model: string): Promise<string> {
  return invoke<string>("ollama_pull_model", { model });
}
