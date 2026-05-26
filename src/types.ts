export type PlanifyTaskStatus = "scheduled" | "claimed" | "delivered" | "failed" | "cancelled";

export interface PlanifyTask {
  id: string;
  dueAt: number;
  createdAt: number;
  updatedAt: number;
  sessionFile: string;
  cwd: string;
  message: string;
  status: PlanifyTaskStatus;
  attempts: number;
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
}
