import { invoke } from "@tauri-apps/api/core";

import { loadAiceryConfig } from "../agent/config";
import {
  loadWorkflowConfig,
  loadTeamContext,
  teamContextPromptBlock,
  type WorkflowConfig,
} from "../config/workspace-config";

export type ResolvedAgent = {
  agentId: string;
  provider?: string;
  enrichedInput: string;
};

type RouteResponse = {
  agent_id: string;
  provider?: string | null;
  tier?: string | null;
};

function inferTaskType(input: string): string {
  const lower = input.toLowerCase();
  if (
    /refactor|move|extract|migrate|rename|split|crate/.test(lower)
  ) {
    return "refactor";
  }
  if (
    /debug|complex|architecture|design|root cause|investigate/.test(lower) ||
    /fix.*error/.test(lower)
  ) {
    return "complex_fix";
  }
  return "edit";
}

function matchWorkflowOverride(
  config: WorkflowConfig,
  task: string,
): { agentId?: string; provider?: string } | null {
  for (const override of config.overrides) {
    const when = override.when ?? {};
    if (when.task && when.task !== task) {
      continue;
    }
    return {
      agentId: override.agent_id,
      provider: override.provider,
    };
  }
  return null;
}

async function callAiceryRoute(
  input: string,
  workspaceId?: string,
): Promise<RouteResponse | null> {
  const { runtime_url, api_key } = loadAiceryConfig();
  try {
    return await invoke<RouteResponse>("aicery_route", {
      runtimeUrl: runtime_url,
      apiKey: api_key,
      input,
      workspaceId: workspaceId ?? null,
    });
  } catch {
    return null;
  }
}

export async function resolveAgentForTask(
  input: string,
  workspaceRoot: string,
  workspaceId?: string,
): Promise<ResolvedAgent> {
  const task = inferTaskType(input);
  const [workflow, team] = await Promise.all([
    loadWorkflowConfig(workspaceRoot),
    loadTeamContext(workspaceRoot),
  ]);

  const teamBlock = teamContextPromptBlock(team);
  const enrichedInput = teamBlock
    ? `${teamBlock}\n\n[Task]\n${input.trim()}`
    : input.trim();

  const override = matchWorkflowOverride(workflow, task);
  if (override?.agentId) {
    return {
      agentId: override.agentId,
      provider: override.provider,
      enrichedInput,
    };
  }

  const routed = await callAiceryRoute(enrichedInput, workspaceId);
  if (routed?.agent_id) {
    return {
      agentId: routed.agent_id,
      provider: routed.provider ?? undefined,
      enrichedInput,
    };
  }

  return {
    agentId: "multi-file-editor",
    enrichedInput,
  };
}
