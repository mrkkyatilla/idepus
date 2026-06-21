export {
  destroyTerminal,
  getTerminalPanel,
  initTerminal,
  initTerminalErrorFix,
  launchTerminalFix,
  onWorkspaceOpened,
  toggleTerminal,
  unbindTerminalWorkspace,
} from "./index";
export type { TerminalErrorFixHost } from "./error-fix";
export type { TerminalPanel } from "./panel";
export type {
  ErrorPattern,
  TerminalContext,
  TerminalCreateResult,
  TerminalErrorDetectedPayload,
  TerminalErrorsClearedPayload,
  TerminalOutputPayload,
} from "./types";
