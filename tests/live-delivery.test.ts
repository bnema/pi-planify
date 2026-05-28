import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { deliverLiveDueTasks } from "../src/live-delivery.js";
import { PlanifyStore } from "../src/store.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pi-planify-live-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("deliverLiveDueTasks", () => {
  test("sends due tasks into the matching live session and marks them delivered", async () => {
    const store = new PlanifyStore({ rootDir: dir, now: () => 10_000, createId: () => "task-1" });
    await store.add({ dueAt: 9_000, sessionFile: "/tmp/session.jsonl", cwd: "/tmp/project", message: "run checks" });
    const messages: string[] = [];

    const result = await deliverLiveDueTasks({
      store,
      rootDir: dir,
      now: () => 10_000,
      workerId: "live-1",
      sessionFile: "/tmp/session.jsonl",
      sendUserMessage: (message) => {
        messages.push(message);
      },
    });

    expect(result).toEqual({ claimed: 1, delivered: 1, failed: 0 });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("run checks");
    expect(await store.get("task-1")).toEqual(expect.objectContaining({ status: "delivered", runCount: 1 }));
  });

  test("does not claim tasks for a different session", async () => {
    const store = new PlanifyStore({ rootDir: dir, now: () => 10_000, createId: () => "task-1" });
    await store.add({ dueAt: 9_000, sessionFile: "/tmp/other.jsonl", cwd: "/tmp/project", message: "run checks" });

    const result = await deliverLiveDueTasks({
      store,
      rootDir: dir,
      now: () => 10_000,
      workerId: "live-1",
      sessionFile: "/tmp/session.jsonl",
      sendUserMessage: () => undefined,
    });

    expect(result).toEqual({ claimed: 0, delivered: 0, failed: 0 });
    expect((await store.get("task-1"))?.status).toBe("scheduled");
  });

  test("marks failed when sendUserMessage throws", async () => {
    const store = new PlanifyStore({ rootDir: dir, now: () => 10_000, createId: () => "task-1" });
    await store.add({ dueAt: 9_000, sessionFile: "/tmp/session.jsonl", cwd: "/tmp/project", message: "run checks" });

    const result = await deliverLiveDueTasks({
      store,
      rootDir: dir,
      now: () => 10_000,
      workerId: "live-1",
      sessionFile: "/tmp/session.jsonl",
      sendUserMessage: () => {
        throw new Error("session closed");
      },
    });

    expect(result).toEqual({ claimed: 1, delivered: 0, failed: 1 });
    expect(await store.get("task-1")).toEqual(expect.objectContaining({ status: "failed", lastError: "session closed", attempts: 1 }));
  });

  test("counts delivery as failed when a claimed task cannot be marked delivered", async () => {
    const task = { id: "task-1", dueAt: 9_000, sessionFile: "/tmp/session.jsonl", cwd: "/tmp/project", message: "run checks" };
    const store = {
      claimDue: async () => [task],
      markDelivered: async (_id: string, _owner: string) => false,
      markFailed: async (_id: string, _owner: string, _error: string) => true,
    } as unknown as PlanifyStore;

    const result = await deliverLiveDueTasks({
      store,
      rootDir: dir,
      now: () => 10_000,
      workerId: "live-1",
      sessionFile: "/tmp/session.jsonl",
      sendUserMessage: () => undefined,
    });

    expect(result).toEqual({ claimed: 1, delivered: 0, failed: 1 });
  });

  test("delivers recurring occurrence and reschedules the next one", async () => {
    const store = new PlanifyStore({ rootDir: dir, now: () => 10_000, createId: () => "task-1" });
    await store.add({ dueAt: 9_000, sessionFile: "/tmp/session.jsonl", cwd: "/tmp/project", message: "run checks", intervalMs: 3_600_000 });

    const result = await deliverLiveDueTasks({
      store,
      rootDir: dir,
      now: () => 10_000,
      workerId: "live-1",
      sessionFile: "/tmp/session.jsonl",
      sendUserMessage: () => undefined,
    });

    expect(result).toEqual({ claimed: 1, delivered: 1, failed: 0 });
    expect(await store.get("task-1")).toEqual(expect.objectContaining({ status: "scheduled", dueAt: 3_610_000, runCount: 1 }));
  });

  test("keeps recurring tasks failed when live delivery fails", async () => {
    const store = new PlanifyStore({ rootDir: dir, now: () => 10_000, createId: () => "task-1" });
    await store.add({ dueAt: 9_000, sessionFile: "/tmp/session.jsonl", cwd: "/tmp/project", message: "run checks", intervalMs: 3_600_000 });

    const result = await deliverLiveDueTasks({
      store,
      rootDir: dir,
      now: () => 10_000,
      workerId: "live-1",
      sessionFile: "/tmp/session.jsonl",
      sendUserMessage: () => {
        throw new Error("session closed");
      },
    });

    expect(result).toEqual({ claimed: 1, delivered: 0, failed: 1 });
    expect(await store.get("task-1")).toEqual(expect.objectContaining({ status: "failed", dueAt: 9_000, runCount: 0, lastError: "session closed" }));
  });

  test("serializes concurrent deliveries to the same session", async () => {
    let nextId = 0;
    const store = new PlanifyStore({ rootDir: dir, now: () => 10_000, createId: () => `task-${nextId++}` });
    await store.add({ dueAt: 9_000, sessionFile: "/tmp/session.jsonl", cwd: "/tmp/project", message: "first" });
    await store.add({ dueAt: 9_000, sessionFile: "/tmp/session.jsonl", cwd: "/tmp/project", message: "second" });
    let active = 0;
    let maxActive = 0;
    let firstDeliveryStarted: (() => void) | undefined;
    const firstDeliveryStartedPromise = new Promise<void>((resolve) => {
      firstDeliveryStarted = resolve;
    });

    const sendUserMessage = async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      firstDeliveryStarted?.();
      await new Promise((resolve) => setTimeout(resolve, 100));
      active -= 1;
    };

    const firstRun = deliverLiveDueTasks({ store, rootDir: dir, now: () => 10_000, workerId: "live-1", sessionFile: "/tmp/session.jsonl", limit: 1, sendUserMessage });
    await firstDeliveryStartedPromise;
    const secondRun = deliverLiveDueTasks({ store, rootDir: dir, now: () => 10_000, workerId: "live-2", sessionFile: "/tmp/session.jsonl", limit: 1, sendUserMessage });
    const [first, second] = await Promise.all([firstRun, secondRun]);

    expect(first.failed + second.failed).toBe(0);
    expect(first.delivered + second.delivered).toBe(2);
    expect(maxActive).toBe(1);
  });
});
