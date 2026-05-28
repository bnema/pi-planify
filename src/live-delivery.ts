import { randomUUID } from "node:crypto";

import { withSessionLock } from "./lock.js";
import { formatScheduledMessage } from "./message.js";
import { defaultPlanifyRoot } from "./paths.js";
import { PlanifyStore } from "./store.js";
import type { DeliverySummary } from "./types.js";

export type SendUserMessageFn = (content: string, options?: { deliverAs?: "steer" | "followUp" }) => void | Promise<void>;

export interface DeliverLiveDueOptions {
  store?: PlanifyStore;
  rootDir?: string;
  now?: () => number;
  workerId?: string;
  sessionFile: string;
  limit?: number;
  staleClaimMs?: number;
  sendUserMessage: SendUserMessageFn;
}

export async function deliverLiveDueTasks(options: DeliverLiveDueOptions): Promise<DeliverySummary> {
  const rootDir = options.rootDir ?? defaultPlanifyRoot();
  const store = options.store ?? new PlanifyStore({ rootDir, now: options.now });
  const workerId = options.workerId ?? `live-${process.pid}-${randomUUID()}`;
  const tasks = await store.claimDue({
    limit: options.limit ?? 5,
    workerId,
    staleClaimMs: options.staleClaimMs ?? 60_000,
    sessionFile: options.sessionFile,
    deliveryMode: "live",
  });
  const summary: DeliverySummary = { claimed: tasks.length, delivered: 0, failed: 0 };

  for (const task of tasks) {
    try {
      await withSessionLock(rootDir, task, async () => {
        const message = formatScheduledMessage({ ...task, deliveredAt: options.now?.() ?? Date.now() });
        await options.sendUserMessage(message, { deliverAs: "followUp" });
        if (await store.markDelivered(task.id, workerId)) {
          summary.delivered += 1;
          return;
        }

        await store.markFailed(task.id, workerId, "Task could not be marked delivered because it was no longer claimed by this live session.");
        summary.failed += 1;
      });
    } catch (error) {
      await store.markFailed(task.id, workerId, error instanceof Error ? error.message : String(error));
      summary.failed += 1;
    }
  }

  return summary;
}
