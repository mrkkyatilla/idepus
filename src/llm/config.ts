import { invoke } from "@tauri-apps/api/core";

export type ProviderId = "openai" | "anthropic";

export type ProviderInfo = {
  id: ProviderId;
  name: string;
  requires_api_key: boolean;
  default_model: string;
};

export type ProviderConfig = {
  provider_id: ProviderId;
  model: string;
  has_api_key: boolean;
};

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: Array<{
    type: string;
    text: string;
    cache_control?: { type: string };
  }>;
};

export type GenerateOptions = {
  model: string;
  temperature?: number;
  max_tokens?: number;
};

export type SetActiveProviderRequest = {
  provider_id: string;
  model?: string;
  api_key?: string;
};

export type MentionRequest = {
  kind: "file" | "folder" | "docs";
  path: string;
};

export async function getProviders(): Promise<ProviderInfo[]> {
  return invoke<ProviderInfo[]>("get_providers");
}

export async function getActiveProvider(): Promise<ProviderConfig> {
  return invoke<ProviderConfig>("get_active_provider");
}

export async function setActiveProvider(
  config: SetActiveProviderRequest,
): Promise<ProviderConfig> {
  return invoke<ProviderConfig>("set_active_provider", { config });
}

export async function testLlmConnection(): Promise<void> {
  return invoke("test_llm_connection");
}

export type AiceryProviderSyncResult = {
  wrote_file: boolean;
  path: string;
  needs_aicery_reload: boolean;
};

export async function syncAiceryProviderEnv(): Promise<AiceryProviderSyncResult> {
  return invoke<AiceryProviderSyncResult>("sync_aicery_provider_env");
}

export function textMessage(
  role: ChatMessage["role"],
  text: string,
): ChatMessage {
  return {
    role,
    content: [{ type: "text", text }],
  };
}

export const SYSTEM_PROMPT = `You are a code editing assistant. You MUST respond using one or more SEARCH/REPLACE blocks only:

<<<<<<< SEARCH
exact text to find (must match the file exactly)
=======
replacement text
>>>>>>> REPLACE

Rules:
- Only patch the selected region; do not rewrite the entire file.
- Use exact whitespace and indentation in SEARCH blocks.
- No markdown fences or prose outside the blocks.`;

export function buildCmdkMessages(
  filePath: string,
  selection: string,
  instruction: string,
  mentions?: MentionRequest[],
): ChatMessage[] {
  let user = "";

  if (mentions && mentions.length > 0) {
    user += "Referenced paths:\n";
    for (const mention of mentions) {
      user += `- ${mention.path}\n`;
    }
    user += "\n";
  }

  user += `File: ${filePath}\n\nSelected code:\n\`\`\`\n${selection}\n\`\`\`\n\nInstruction: ${instruction}\n\nRespond with SEARCH/REPLACE block(s) that modify only the selected code.`;
  return [textMessage("system", SYSTEM_PROMPT), textMessage("user", user)];
}
