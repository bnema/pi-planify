import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";

import { type CommandResult, type CommandRunner, runCommand } from "./command-runner.js";
import { withLock } from "./lock.js";
import { formatScheduledMessage } from "./message.js";
import { defaultPlanifyRoot } from "./paths.js";
import { PlanifyStore } from "./store.js";
import type { PlanifyTask } from "./types.js";

export type ExecResult = CommandResult;
export type ExecFn = CommandRunner;

export interface DeliverDueOptions {
  store?: PlanifyStore;
  rootDir?: string;
  now?: () => number;
  workerId?: string;
  piBin?: string;
  limit?: number;
  staleClaimMs?: number;
  exec?: ExecFn;
}

export interface DeliverySummary {
  claimed: number;
  delivered: number;
  failed: number;
}

export async function deliverDueTasks(options: DeliverDueOptions = {}): Promise<DeliverySummary> {
  const rootDir = options.rootDir ?? defaultPlanifyRoot();
  const store = options.store ?? new PlanifyStore({ rootDir, now: options.now });
  const workerId = options.workerId ?? `worker-${process.pid}-${randomUUID()}`;
  const exec = options.exec ?? runCommand;
  const piBin = options.piBin ?? process.env.PI_PLANIFY_PI_BIN ?? "pi";
  const tasks = await store.claimDue({
    limit: options.limit ?? 10,
    workerId,
    staleClaimMs: options.staleClaimMs ?? 15 * 60_000,
  });
  const summary: DeliverySummary = { claimed: tasks.length, delivered: 0, failed: 0 };

  for (const task of tasks) {
    try {
      await withSessionLock(rootDir, task, async () => {
        const message = formatScheduledMessage({ ...task, deliveredAt: options.now?.() ?? Date.now() });
        const result = await exec(piBin, ["--session", task.sessionFile, "-p", message], { cwd: task.cwd });
        if (result.exitCode === 0) {
          if (await store.markDelivered(task.id, workerId)) {
            summary.delivered += 1;
            return;
          }

          await store.markFailed(task.id, workerId, "Task could not be marked delivered because it was no longer claimed by this worker.");
          summary.failed += 1;
          return;
        }

        const error = result.stderr.trim() || result.stdout.trim() || `pi exited with code ${result.exitCode}`;
        await store.markFailed(task.id, workerId, error);
        summary.failed += 1;
      });
    } catch (error) {
      await store.markFailed(task.id, workerId, error instanceof Error ? error.message : String(error));
      summary.failed += 1;
    }
  }

  return summary;
}

async function withSessionLock<T>(rootDir: string, task: PlanifyTask, run: () => Promise<T>): Promise<T> {
  const digest = createHash("sha256").update(task.sessionFile).digest("hex").slice(0, 32);
  return await withLock(join(rootDir, "locks", `${digest}.lock`), run);
}
