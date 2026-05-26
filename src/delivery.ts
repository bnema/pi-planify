import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";

import { formatScheduledMessage } from "./message.js";
import { defaultPlanifyRoot } from "./paths.js";
import { PlanifyStore } from "./store.js";
import type { PlanifyTask } from "./types.js";

export interface ExecResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export type ExecFn = (command: string, args: string[], options: { cwd: string }) => Promise<ExecResult>;

export interface DeliverDueOptions {
  store?: PlanifyStore;
  rootDir?: string;
  now?: () => number;
  workerId?: string;
  piBin?: string;
  limit?: number;
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
  const exec = options.exec ?? execFile;
  const piBin = options.piBin ?? process.env.PI_PLANIFY_PI_BIN ?? "pi";
  const tasks = await store.claimDue({ limit: options.limit ?? 10, workerId });
  const summary: DeliverySummary = { claimed: tasks.length, delivered: 0, failed: 0 };

  for (const task of tasks) {
    try {
      await withSessionLock(rootDir, task, async () => {
        const message = formatScheduledMessage(task);
        const result = await exec(piBin, ["--session", task.sessionFile, "-p", message], { cwd: task.cwd });
        if (result.exitCode === 0) {
          await store.markDelivered(task.id);
          summary.delivered += 1;
          return;
        }

        const error = result.stderr.trim() || result.stdout.trim() || `pi exited with code ${result.exitCode}`;
        await store.markFailed(task.id, error);
        summary.failed += 1;
      });
    } catch (error) {
      await store.markFailed(task.id, error instanceof Error ? error.message : String(error));
      summary.failed += 1;
    }
  }

  return summary;
}

async function withSessionLock<T>(rootDir: string, task: PlanifyTask, run: () => Promise<T>): Promise<T> {
  const digest = createHash("sha256").update(task.sessionFile).digest("hex").slice(0, 32);
  const lockDir = join(rootDir, "locks", `${digest}.lock`);
  await mkdir(join(rootDir, "locks"), { recursive: true });
  await mkdir(lockDir);
  try {
    return await run();
  } finally {
    await rm(lockDir, { recursive: true, force: true });
  }
}

export async function execFile(command: string, args: string[], options: { cwd: string }): Promise<ExecResult> {
  return await new Promise<ExecResult>((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("exit", (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}
