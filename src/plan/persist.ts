import { invoke } from "@tauri-apps/api/core";

import type { PlanDocument, PlanMeta, PlanStatus } from "./types";

export async function writePlanFile(req: {
  title: string;
  content: string;
  planId?: string;
  runId?: string;
  sessionId?: string;
}): Promise<PlanDocument> {
  return invoke<PlanDocument>("write_plan_file", {
    req: {
      title: req.title,
      content: req.content,
      planId: req.planId,
      runId: req.runId,
      sessionId: req.sessionId,
    },
  });
}

export async function readPlan(planId: string): Promise<PlanDocument> {
  return invoke<PlanDocument>("read_plan", { req: { planId } });
}

export async function writePlan(req: {
  planId: string;
  content: string;
  title?: string;
  status?: PlanStatus;
  implementRunId?: string;
}): Promise<PlanMeta> {
  return invoke<PlanMeta>("write_plan", { req });
}

export async function updatePlanStatus(req: {
  planId: string;
  status: PlanStatus;
  implementRunId?: string;
}): Promise<PlanMeta> {
  return invoke<PlanMeta>("update_plan_status", { req });
}

export async function listPlans(): Promise<PlanMeta[]> {
  return invoke<PlanMeta[]>("list_plans");
}
