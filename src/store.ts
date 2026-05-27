import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import { withLock } from "./lock.js";
import type { AddTaskInput, PlanifyTask } from "./types.js";

interface StoreFile {
  version: 1;
  tasks: PlanifyTask[];
}

export interface PlanifyStoreOptions {
  rootDir: string;
  now?: () => number;
  createId?: () => string;
}

export class PlanifyStore {
  private readonly dbPath: string;
  private readonly now: () => number;
  private readonly createId: () => string;

  constructor(options: PlanifyStoreOptions) {
    this.dbPath = join(options.rootDir, "tasks.json");
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? (() => randomUUID());
  }

  async add(input: AddTaskInput): Promise<PlanifyTask> {
    return await this.withStoreLock(async () => {
      const file = await this.readFile();
      const timestamp = this.now();
      const task: PlanifyTask = {
        id: this.createId(),
        dueAt: input.dueAt,
        createdAt: timestamp,
        updatedAt: timestamp,
        sessionFile: input.sessionFile,
        cwd: input.cwd,
        message: input.message,
        status: "scheduled",
        attempts: 0,
        intervalMs: input.intervalMs,
        maxRuns: input.maxRuns,
        runCount: 0,
      };
      file.tasks.push(task);
      await this.writeFile(file);
      return task;
    });
  }

  async list(): Promise<PlanifyTask[]> {
    return await this.withStoreLock(async () => {
      const file = await this.readFile();
      return file.tasks.map((task) => ({ ...task }));
    });
  }

  async get(id: string): Promise<PlanifyTask | undefined> {
    return await this.withStoreLock(async () => {
      const file = await this.readFile();
      const task = file.tasks.find((candidate) => candidate.id === id);
      return task ? { ...task } : undefined;
    });
  }

  async cancel(id: string): Promise<boolean> {
    return await this.withStoreLock(async () => {
      const file = await this.readFile();
      const task = file.tasks.find((candidate) => candidate.id === id);
      if (!task || task.status !== "scheduled") return false;

      task.status = "cancelled";
      task.updatedAt = this.now();
      await this.writeFile(file);
      return true;
    });
  }

  async requeueStaleClaims(options: { olderThanMs: number }): Promise<number> {
    return await this.withStoreLock(async () => {
      const file = await this.readFile();
      const count = this.requeueStaleClaimsInFile(file, options.olderThanMs);
      if (count > 0) await this.writeFile(file);
      return count;
    });
  }

  async claimDue(options: { limit: number; workerId: string; staleClaimMs?: number }): Promise<PlanifyTask[]> {
    return await this.withStoreLock(async () => {
      const file = await this.readFile();
      let changed = false;
      if (options.staleClaimMs !== undefined) {
        changed = this.requeueStaleClaimsInFile(file, options.staleClaimMs) > 0;
      }

      const timestamp = this.now();
      const claimed: PlanifyTask[] = [];
      for (const task of file.tasks) {
        if (claimed.length >= options.limit) break;
        if (task.status !== "scheduled" || task.dueAt > timestamp) continue;

        task.status = "claimed";
        task.claimedAt = timestamp;
        task.claimedBy = options.workerId;
        task.updatedAt = timestamp;
        task.attempts += 1;
        claimed.push({ ...task });
        changed = true;
      }

      if (changed) await this.writeFile(file);
      return claimed;
    });
  }

  async markDelivered(id: string, owner: string): Promise<boolean> {
    return await this.updateClaimedTask(id, owner, (task, now) => {
      task.runCount = (task.runCount ?? 0) + 1;
      task.deliveredAt = now;
      task.updatedAt = now;
      task.lastError = undefined;
      task.claimedAt = undefined;
      task.claimedBy = undefined;

      if (task.intervalMs !== undefined && (task.maxRuns === undefined || task.runCount < task.maxRuns)) {
        task.status = "scheduled";
        task.dueAt = now + task.intervalMs;
        task.attempts = 0;
      } else {
        task.status = "delivered";
      }
    });
  }

  async markFailed(id: string, owner: string, error: string): Promise<boolean> {
    return await this.updateClaimedTask(id, owner, (task, now) => {
      task.status = "failed";
      task.lastError = error;
      task.updatedAt = now;
      task.claimedAt = undefined;
      task.claimedBy = undefined;
    });
  }

  private async updateClaimedTask(id: string, owner: string, update: (task: PlanifyTask, now: number) => void): Promise<boolean> {
    return await this.withStoreLock(async () => {
      const file = await this.readFile();
      const task = file.tasks.find((candidate) => candidate.id === id);
      if (!task || task.status !== "claimed" || task.claimedBy !== owner) return false;
      update(task, this.now());
      await this.writeFile(file);
      return true;
    });
  }

  private requeueStaleClaimsInFile(file: StoreFile, olderThanMs: number): number {
    const timestamp = this.now();
    let count = 0;
    for (const task of file.tasks) {
      if (task.status !== "claimed") continue;
      const claimedAt = task.claimedAt ?? task.updatedAt;
      if (timestamp - claimedAt < olderThanMs) continue;

      task.status = "scheduled";
      task.updatedAt = timestamp;
      task.lastError = `Recovered stale claim from ${task.claimedBy ?? "unknown worker"}.`;
      task.claimedAt = undefined;
      task.claimedBy = undefined;
      count += 1;
    }
    return count;
  }

  private async readFile(): Promise<StoreFile> {
    try {
      const raw = await readFile(this.dbPath, "utf8");
      const parsed = JSON.parse(raw) as StoreFile;
      const tasks = Array.isArray(parsed.tasks) ? parsed.tasks.map((task) => ({ ...task, runCount: task.runCount ?? 0 })) : [];
      return { version: 1, tasks };
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return { version: 1, tasks: [] };
      }
      throw error;
    }
  }

  private async writeFile(file: StoreFile): Promise<void> {
    await mkdir(dirname(this.dbPath), { recursive: true });
    const tempPath = `${this.dbPath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
    await rename(tempPath, this.dbPath);
  }

  private async withStoreLock<T>(run: () => Promise<T>): Promise<T> {
    return await withLock(join(dirname(this.dbPath), "locks", "store.lock"), run);
  }
}
