import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { deliverDueTasks } from "../src/delivery.js";
import { PlanifyStore } from "../src/store.js";
import { buildSystemdUnits } from "../src/systemd.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pi-planify-worker-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("deliverDueTasks", () => {
  test("runs pi with the target session and marks delivered on success", async () => {
    const store = new PlanifyStore({ rootDir: dir, now: () => 10_000, createId: () => "task-1" });
    await store.add({ dueAt: 9_000, sessionFile: "/tmp/session.jsonl", cwd: "/tmp/project", message: "run tests", deliveryMode: "headless" });
    const calls: Array<{ command: string; args: string[]; cwd: string }> = [];

    const result = await deliverDueTasks({
      store,
      now: () => 10_000,
      workerId: "worker-1",
      exec: async (command, args, options) => {
        calls.push({ command, args, cwd: options.cwd });
        return { exitCode: 0, stdout: "ok", stderr: "" };
      },
    });

    expect(result.delivered).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ command: "pi", cwd: "/tmp/project" });
    expect(calls[0].args.slice(0, 3)).toEqual(["--session", "/tmp/session.jsonl", "-p"]);
    expect(calls[0].args[3]).toContain("run tests");
    expect((await store.get("task-1"))?.status).toBe("delivered");
  });

  test("marks failed when pi exits non-zero", async () => {
    const store = new PlanifyStore({ rootDir: dir, now: () => 10_000, createId: () => "task-1" });
    await store.add({ dueAt: 9_000, sessionFile: "/tmp/session.jsonl", cwd: "/tmp/project", message: "run tests", deliveryMode: "headless" });

    const result = await deliverDueTasks({
      store,
      now: () => 10_000,
      workerId: "worker-1",
      exec: async () => ({ exitCode: 2, stdout: "", stderr: "boom" }),
    });

    expect(result.failed).toBe(1);
    expect((await store.get("task-1"))?.status).toBe("failed");
    expect((await store.get("task-1"))?.lastError).toContain("boom");
  });

  test("delivers one due recurring occurrence and reschedules the next one", async () => {
    const store = new PlanifyStore({ rootDir: dir, now: () => 10_000, createId: () => "task-1" });
    await store.add({ dueAt: 9_000, sessionFile: "/tmp/session.jsonl", cwd: "/tmp/project", message: "run tests", intervalMs: 3_600_000, deliveryMode: "headless" });

    const result = await deliverDueTasks({
      store,
      now: () => 10_000,
      workerId: "worker-1",
      exec: async () => ({ exitCode: 0, stdout: "ok", stderr: "" }),
    });

    expect(result.delivered).toBe(1);
    expect(await store.get("task-1")).toEqual(expect.objectContaining({ status: "scheduled", dueAt: 3_610_000, runCount: 1 }));
  });

  test("keeps recurring tasks failed when delivery fails", async () => {
    const store = new PlanifyStore({ rootDir: dir, now: () => 10_000, createId: () => "task-1" });
    await store.add({ dueAt: 9_000, sessionFile: "/tmp/session.jsonl", cwd: "/tmp/project", message: "run tests", intervalMs: 3_600_000, deliveryMode: "headless" });

    const result = await deliverDueTasks({
      store,
      now: () => 10_000,
      workerId: "worker-1",
      exec: async () => ({ exitCode: 2, stdout: "", stderr: "boom" }),
    });

    expect(result.failed).toBe(1);
    expect(await store.get("task-1")).toEqual(expect.objectContaining({ status: "failed", dueAt: 9_000, runCount: 0, lastError: "boom" }));
  });

  test("counts delivery as failed when a claimed task cannot be marked delivered", async () => {
    const task = { id: "task-1", dueAt: 9_000, sessionFile: "/tmp/session.jsonl", cwd: "/tmp/project", message: "run tests" };
    const store = {
      claimDue: async () => [task],
      markDelivered: async (_id: string, _owner: string) => false,
      markFailed: async (_id: string, _owner: string, _error: string) => true,
    } as unknown as PlanifyStore;

    const result = await deliverDueTasks({
      store,
      rootDir: dir,
      now: () => 10_000,
      workerId: "worker-1",
      exec: async () => ({ exitCode: 0, stdout: "ok", stderr: "" }),
    });

    expect(result).toEqual({ claimed: 1, delivered: 0, failed: 1 });
  });

  test("serializes concurrent deliveries to the same session", async () => {
    let nextId = 0;
    const store = new PlanifyStore({ rootDir: dir, now: () => 10_000, createId: () => `task-${nextId++}` });
    await store.add({ dueAt: 9_000, sessionFile: "/tmp/session.jsonl", cwd: "/tmp/project", message: "first", deliveryMode: "headless" });
    await store.add({ dueAt: 9_000, sessionFile: "/tmp/session.jsonl", cwd: "/tmp/project", message: "second", deliveryMode: "headless" });
    let active = 0;
    let maxActive = 0;
    let firstExecStarted: (() => void) | undefined;
    const firstExecStartedPromise = new Promise<void>((resolve) => {
      firstExecStarted = resolve;
    });

    const exec = async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      firstExecStarted?.();
      await new Promise((resolve) => setTimeout(resolve, 100));
      active -= 1;
      return { exitCode: 0, stdout: "ok", stderr: "" };
    };

    const firstRun = deliverDueTasks({ rootDir: dir, now: () => 10_000, workerId: "worker-1", limit: 1, exec });
    await firstExecStartedPromise;
    const secondRun = deliverDueTasks({ rootDir: dir, now: () => 10_000, workerId: "worker-2", limit: 1, exec });
    const [first, second] = await Promise.all([firstRun, secondRun]);

    expect(first.failed + second.failed).toBe(0);
    expect(first.delivered + second.delivered).toBe(2);
    expect(maxActive).toBe(1);
  });
});

describe("buildSystemdUnits", () => {
  test("creates a persistent timer and service for run-due", () => {
    const units = buildSystemdUnits({ binPath: "/usr/bin/pi-planify" });

    expect(units.service).toContain("ExecStart=/usr/bin/pi-planify run-due");
    expect(units.timer).toContain("OnCalendar=*:0/1");
    expect(units.timer).toContain("Persistent=true");
  });

  test("rejects non-absolute service executable paths", () => {
    expect(() => buildSystemdUnits({ binPath: "pi-planify" })).toThrow(/absolute/);
  });
});
