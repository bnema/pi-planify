export type PlanifyTaskStatus = "scheduled" | "claimed" | "delivered" | "failed" | "cancelled";
export type PlanifyDeliveryMode = "live" | "headless";

export interface DeliverySummary {
  claimed: number;
  delivered: number;
  failed: number;
}

export interface PlanifyTask {
  id: string;
  dueAt: number;
  createdAt: number;
  updatedAt: number;
  sessionFile: string;
  cwd: string;
  message: string;
  status: PlanifyTaskStatus;
  deliveryMode: PlanifyDeliveryMode;
  attempts: number;
  intervalMs?: number;
  maxRuns?: number;
  runCount: number;
  claimedAt?: number;
  claimedBy?: string;
  deliveredAt?: number;
  lastError?: string;
}

export interface AddTaskInput {
  dueAt: number;
  sessionFile: string;
  cwd: string;
  message: string;
  deliveryMode?: PlanifyDeliveryMode;
  intervalMs?: number;
  maxRuns?: number;
}
