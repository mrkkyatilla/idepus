export type ErrorPattern = {
  kind: string;
  file: string | null;
  line: number | null;
  message: string;
};

export type TerminalCreateResult = {
  session_id: string;
};

export type TerminalOutputPayload = {
  session_id: string;
  data: string;
  is_stderr: boolean;
};

export type TerminalErrorDetectedPayload = {
  session_id: string;
  patterns: ErrorPattern[];
};

export type TerminalErrorsClearedPayload = {
  session_id: string;
};

export type TerminalContext = {
  session_id: string;
  cwd: string;
  lines: string[];
  patterns: ErrorPattern[];
};
