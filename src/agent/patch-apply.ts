import { fetchBridgeInfo } from "./config";
import type { ApprovalRequiredEvent } from "./types";

export async function applyPatchFromApproval(
  workspaceRoot: string,
  approval: ApprovalRequiredEvent,
): Promise<void> {
  const bridge = await fetchBridgeInfo();
  const args = approval.arguments;
  const path = String(args.path ?? "");
  const rawPatch = String(args.raw_patch ?? args.rawPatch ?? "");
  if (!path || !rawPatch) {
    throw new Error("Patch payload incomplete");
  }

  const body: Record<string, unknown> = {
    workspace_root: workspaceRoot,
    args: { path, raw_patch: rawPatch },
  };
  if (typeof args.file_content === "string") {
    (body.args as Record<string, unknown>).file_content = args.file_content;
  }

  const response = await fetch(`${bridge.url}/v1/tools/apply_patch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Bridge-Token": bridge.token,
    },
    body: JSON.stringify(body),
  });

  const payload = (await response.json()) as {
    ok?: boolean;
    error?: string;
    result?: unknown;
  };
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error ?? `apply_patch HTTP ${response.status}`);
  }
}
