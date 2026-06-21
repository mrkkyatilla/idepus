import { getActiveRunId } from "./client";
import { getAgentMode } from "./mode";

export function canSwitchSession(): boolean {
  if (getAgentMode() === "multitask") {
    return true;
  }
  return !getActiveRunId();
}
