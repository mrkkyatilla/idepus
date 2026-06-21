export type PatchHunk = {
  id: string;
  start_byte: number;
  end_byte: number;
  start_line: number;
  end_line: number;
  search_text: string;
  replace_text: string;
};

export type Patch = {
  patch_id: string;
  path: string;
  hunks: PatchHunk[];
};

/** Faz 06 Aicery HITL — same shape as SSE approval_required payload */
export type ApprovalRequiredPayload = {
  run_id: string;
  path: string;
  raw_patch: string;
  patch_id?: string;
};

export type ApplyPatchRequest = {
  path: string;
  file_content: string;
  hunks: PatchHunk[];
  accepted_ids: string[];
};

export type ParsePatchRequest = {
  raw_llm_output: string;
  file_path: string;
  file_content: string;
};
