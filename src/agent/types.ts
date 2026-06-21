export type AgentStepStatus = "pending" | "running" | "done" | "error";

export type AgentStep = {
  id: string;
  label: string;
  status: AgentStepStatus;
  startedAt?: number;
  endedAt?: number;
  detail?: string;
};

export type AgentRunRecord = {
  runId: string;
  agentId: string;
  input: string;
  status: string;
  startedAt: number;
  endedAt?: number;
  output?: string;
};

export type ApprovalRequiredEvent = {
  approval_id: string;
  tool_name: string;
  arguments: Record<string, unknown>;
  expires_at?: string;
};
