export type ChatRole = "user" | "assistant" | "system";

export type ActivityEntry = {
  id: string;
  label: string;
  status: "running" | "done" | "error";
};

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  runId?: string;
  streaming?: boolean;
  createdAt: number;
  contextHits?: import("../memory/types").ContextHits;
  /** Plan-mode progress lines (info boxes, not main output). */
  activity?: ActivityEntry[];
};
