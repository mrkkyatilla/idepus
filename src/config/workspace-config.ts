import { invoke } from "@tauri-apps/api/core";

export type WorkflowOverride = {
  when: Record<string, string>;
  agent_id?: string;
  provider?: string;
};

export type WorkflowConfig = {
  version: number;
  overrides: WorkflowOverride[];
};

export type TeamContext = {
  architecture: string[];
  protected_patterns: string[];
  preferred_libraries: string[];
};

const cache = new Map<string, { workflow: WorkflowConfig; team: TeamContext }>();

function cacheKey(root: string): string {
  return root;
}

export async function loadWorkflowConfig(
  workspaceRoot: string,
): Promise<WorkflowConfig> {
  const key = cacheKey(workspaceRoot);
  const hit = cache.get(key);
  if (hit) {
    return hit.workflow;
  }
  const workflow = await invoke<WorkflowConfig>("load_workflow_config_cmd", {
    workspaceRoot,
  });
  const team = await invoke<TeamContext>("load_team_context_cmd", {
    workspaceRoot,
  });
  cache.set(key, { workflow, team });
  return workflow;
}

export async function loadTeamContext(
  workspaceRoot: string,
): Promise<TeamContext> {
  const key = cacheKey(workspaceRoot);
  const hit = cache.get(key);
  if (hit) {
    return hit.team;
  }
  const team = await invoke<TeamContext>("load_team_context_cmd", {
    workspaceRoot,
  });
  const workflow = await invoke<WorkflowConfig>("load_workflow_config_cmd", {
    workspaceRoot,
  });
  cache.set(key, { workflow, team });
  return team;
}

export function clearWorkspaceConfigCache(): void {
  cache.clear();
}

export function teamContextPromptBlock(context: TeamContext): string {
  const lines: string[] = [];
  for (const rule of context.architecture) {
    lines.push(`- ${rule}`);
  }
  for (const pattern of context.protected_patterns) {
    lines.push(`- Protected path: ${pattern}`);
  }
  for (const lib of context.preferred_libraries) {
    lines.push(`- Prefer library: ${lib}`);
  }
  if (lines.length === 0) {
    return "";
  }
  return `[Team context]\n${lines.join("\n")}`;
}
