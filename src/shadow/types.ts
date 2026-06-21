export type ShadowPrepareResult = {
  shadow_id: string;
  shadow_root: string;
};

export type CommandResult = {
  exit_code: number;
  passed: boolean;
  output_lines: string[];
  stderr_summary: string;
  skipped: boolean;
};

export type ShadowTestConfig = {
  command?: string;
  args?: string[];
  timeoutSecs?: number;
};
