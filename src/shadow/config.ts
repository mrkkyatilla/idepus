import type { ShadowTestConfig } from "./types";

const COMMAND_KEY = "idepus.shadowTestCommand";
const ARGS_KEY = "idepus.shadowTestArgs";
const TIMEOUT_KEY = "idepus.shadowTimeoutSecs";

export function loadShadowTestConfig(): ShadowTestConfig {
  const command = localStorage.getItem(COMMAND_KEY) ?? undefined;
  const argsRaw = localStorage.getItem(ARGS_KEY);
  let args: string[] | undefined;
  if (argsRaw) {
    try {
      const parsed = JSON.parse(argsRaw) as string[];
      if (Array.isArray(parsed)) {
        args = parsed;
      }
    } catch {
      // ignore
    }
  }
  const timeoutRaw = localStorage.getItem(TIMEOUT_KEY);
  const timeoutSecs = timeoutRaw ? Number(timeoutRaw) : 120;
  return {
    command: command || undefined,
    args,
    timeoutSecs: Number.isFinite(timeoutSecs) ? timeoutSecs : 120,
  };
}

export function saveShadowTestConfig(config: ShadowTestConfig): void {
  if (config.command) {
    localStorage.setItem(COMMAND_KEY, config.command);
  } else {
    localStorage.removeItem(COMMAND_KEY);
  }
  if (config.args && config.args.length > 0) {
    localStorage.setItem(ARGS_KEY, JSON.stringify(config.args));
  } else {
    localStorage.removeItem(ARGS_KEY);
  }
  if (config.timeoutSecs) {
    localStorage.setItem(TIMEOUT_KEY, String(config.timeoutSecs));
  }
}
