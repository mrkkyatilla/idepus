export type PlanStatus = "draft" | "approved" | "implementing" | "done";

export type PlanMeta = {
  id: string;
  path: string;
  title: string;
  status: PlanStatus;
  createdAt: number;
  updatedAt: number;
  runId?: string;
  implementRunId?: string;
  sessionId?: string;
};

export type PlanDocument = {
  meta: PlanMeta;
  content: string;
};
