import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Run, SseEvent } from "@aicery/sdk";

import { loadAiceryConfig } from "./config";
import { setLastAgentId, setLastRunId } from "../session/index";
import {
  getForegroundRunId,
  setForegroundRun,
  unregisterRun,
} from "./run-registry";

export type ResumeRunOptions = {
  decision: "approve" | "reject" | "modify";
  approvalId?: string;
  arguments?: Record<string, unknown>;
};

type AiceryRunResponse = {
  id: string;
  status: string;
  agent_id: string;
  input_text?: string | null;
  output_text?: string | null;
  error_code?: string | null;
  error_message?: string | null;
};

type AicerySsePayload = {
  run_id: string;
  event: string;
  data: Record<string, unknown>;
};

type SseHandler = (event: SseEvent) => void;

const runHandlers = new Map<string, SseHandler>();
let globalUnlisten: UnlistenFn | null = null;
let listenerReady: Promise<void> | null = null;

function authArgs() {
  const config = loadAiceryConfig();
  return {
    runtimeUrl: config.runtime_url,
    apiKey: config.api_key,
  };
}

function mapRun(run: AiceryRunResponse): Run {
  return {
    id: run.id,
    status: run.status,
    agent_id: run.agent_id,
    input_text: run.input_text ?? null,
    output_text: run.output_text ?? null,
    error_code: run.error_code ?? null,
    error_message: run.error_message ?? null,
  };
}

async function ensureGlobalListener(): Promise<void> {
  if (globalUnlisten) {
    return;
  }
  if (!listenerReady) {
    listenerReady = (async () => {
      globalUnlisten = await listen<AicerySsePayload>("aicery_sse_event", (message) => {
        const { run_id: runId, event, data } = message.payload;
        const handler = runHandlers.get(runId);
        handler?.({ event, data });
      });
    })();
  }
  await listenerReady;
}

export function getActiveRunId(): string | null {
  return getForegroundRunId();
}

export function clearActiveRunId(): void {
  setForegroundRun(null);
}

export async function createRun(
  agentId: string,
  input: string,
  options?: {
    workspaceId?: string;
    hostWorkspaceRoot?: string;
  },
): Promise<Run> {
  const run = await invoke<AiceryRunResponse>("aicery_create_run", {
    ...authArgs(),
    agentId,
    input,
    workspaceId: options?.workspaceId,
    hostWorkspaceRoot: options?.hostWorkspaceRoot,
  });

  setLastRunId(run.id);
  setLastAgentId(agentId);
  return mapRun(run);
}

export async function getRun(runId: string): Promise<Run> {
  const run = await invoke<AiceryRunResponse>("aicery_get_run", {
    ...authArgs(),
    runId,
  });
  return mapRun(run);
}

export async function startStreamRun(
  runId: string,
  onEvent: (event: SseEvent) => void,
): Promise<void> {
  await ensureGlobalListener();

  return new Promise<void>((resolve, reject) => {
    const handler = (event: SseEvent) => {
      try {
        onEvent(event);
      } catch (err) {
        runHandlers.delete(runId);
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      if (event.event === "done") {
        runHandlers.delete(runId);
        resolve();
        return;
      }
      if (event.event === "error") {
        runHandlers.delete(runId);
        const msg = String(
          event.data.error_message ?? event.data.message ?? "Stream error",
        );
        reject(new Error(msg));
      }
    };

    runHandlers.set(runId, handler);
    setForegroundRun(runId);
    setLastRunId(runId);

    void invoke("aicery_stream_run", {
      ...authArgs(),
      runId,
    }).catch((err) => {
      runHandlers.delete(runId);
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });
}

export function detachStreamRun(runId: string): void {
  runHandlers.delete(runId);
}

export async function resumeRun(
  runId: string,
  options: ResumeRunOptions,
): Promise<Run> {
  const run = await invoke<AiceryRunResponse>("aicery_resume_run", {
    ...authArgs(),
    runId,
    decision: options.decision,
    approvalId: options.approvalId,
    toolArguments: options.arguments,
  });
  return mapRun(run);
}

export async function cancelRun(runId: string): Promise<void> {
  await invoke("aicery_cancel_run", { runId });
  runHandlers.delete(runId);
  unregisterRun(runId);
  if (getForegroundRunId() === runId) {
    setForegroundRun(null);
    setLastRunId(undefined);
  }
}

export async function cancelActiveRun(): Promise<void> {
  const foreground = getForegroundRunId();
  if (foreground) {
    await cancelRun(foreground);
    return;
  }
  await invoke("aicery_cancel_stream");
  runHandlers.clear();
  setForegroundRun(null);
  setLastRunId(undefined);
}

export async function listAgents(): Promise<string[]> {
  const { fetchSidecarStatus } = await import("./config");
  const status = await fetchSidecarStatus();
  return status.agents;
}
