import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

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
    };
    file.tasks.push(task);
    await this.writeFile(file);
    return task;
  }

  async list(): Promise<PlanifyTask[]> {
    const file = await this.readFile();
    return file.tasks.map((task) => ({ ...task }));
  }

  async get(id: string): Promise<PlanifyTask | undefined> {
    const file = await this.readFile();
    const task = file.tasks.find((candidate) => candidate.id === id);
    return task ? { ...task } : undefined;
  }

  async cancel(id: string): Promise<boolean> {
    const file = await this.readFile();
    const task = file.tasks.find((candidate) => candidate.id === id);
    if (!task || task.status !== "scheduled") return false;

    task.status = "cancelled";
    task.updatedAt = this.now();
    await this.writeFile(file);
    return true;
  }

  async claimDue(options: { limit: number; workerId: string }): Promise<PlanifyTask[]> {
    const file = await this.readFile();
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
    }

    if (claimed.length > 0) await this.writeFile(file);
    return claimed;
  }

  async markDelivered(id: string): Promise<boolean> {
    return await this.updateTask(id, (task, now) => {
      task.status = "delivered";
      task.deliveredAt = now;
      task.updatedAt = now;
      task.lastError = undefined;
    });
  }

  async markFailed(id: string, error: string): Promise<boolean> {
    return await this.updateTask(id, (task, now) => {
      task.status = "failed";
      task.lastError = error;
      task.updatedAt = now;
    });
  }

  private async updateTask(id: string, update: (task: PlanifyTask, now: number) => void): Promise<boolean> {
    const file = await this.readFile();
    const task = file.tasks.find((candidate) => candidate.id === id);
    if (!task) return false;
    update(task, this.now());
    await this.writeFile(file);
    return true;
  }

  private async readFile(): Promise<StoreFile> {
    try {
      const raw = await readFile(this.dbPath, "utf8");
      const parsed = JSON.parse(raw) as StoreFile;
      return { version: 1, tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [] };
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return { version: 1, tasks: [] };
      }
      throw error;
    }
  }

  private async writeFile(file: StoreFile): Promise<void> {
    await mkdir(dirname(this.dbPath), { recursive: true });
    const tempPath = `${this.dbPath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
    await rename(tempPath, this.dbPath);
  }
}
