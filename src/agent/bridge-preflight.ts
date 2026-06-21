import { fetchBridgeInfo } from "./config";

export async function pingBridge(
  workspaceRoot: string,
): Promise<{ ok: boolean; message: string }> {
  try {
    const bridge = await fetchBridgeInfo();
    const response = await fetch(`${bridge.url}/v1/tools/list_dir`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Bridge-Token": bridge.token,
      },
      body: JSON.stringify({
        workspace_root: workspaceRoot,
        args: { path: "", recursive: false },
      }),
    });
    const payload = (await response.json()) as {
      ok?: boolean;
      error?: string;
    };
    if (!response.ok || !payload.ok) {
      return {
        ok: false,
        message:
          payload.error ??
          `Tool bridge HTTP ${response.status} — idepus açık ve workspace yüklü mü?`,
      };
    }
    return { ok: true, message: "bridge ok" };
  } catch (err) {
    return {
      ok: false,
      message: `Tool bridge unreachable — idepus açık ve workspace yüklü mü? (${String(err)})`,
    };
  }
}
