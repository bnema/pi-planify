import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { PlanifyStore } from "../src/store.js";
import { formatScheduledMessage } from "../src/message.js";
import { parseInterval, parseWhen } from "../src/time.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pi-planify-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("PlanifyStore", () => {
  test("persists scheduled tasks across store instances", async () => {
    const store = new PlanifyStore({ rootDir: dir, now: () => 1_000 });

    const task = await store.add({
      dueAt: 2_000,
      sessionFile: "/tmp/session.jsonl",
      cwd: "/tmp/project",
      message: "review the pending changes",
    });

    const reloaded = new PlanifyStore({ rootDir: dir, now: () => 1_500 });
    expect(await reloaded.list()).toEqual([
      expect.objectContaining({
        id: task.id,
        status: "scheduled",
        dueAt: 2_000,
        sessionFile: "/tmp/session.jsonl",
        cwd: "/tmp/project",
        message: "review the pending changes",
        attempts: 0,
      }),
    ]);
  });

  test("persists recurring task options", async () => {
    const store = new PlanifyStore({ rootDir: dir, now: () => 1_000, createId: () => "task-1" });

    await store.add({
      dueAt: 3_601_000,
      sessionFile: "/tmp/session.jsonl",
      cwd: "/tmp/project",
      message: "review the pending changes",
      intervalMs: 3_600_000,
      maxRuns: 3,
    });

    const task = await new PlanifyStore({ rootDir: dir }).get("task-1");
    expect(task).toEqual(expect.objectContaining({ intervalMs: 3_600_000, maxRuns: 3, runCount: 0 }));
  });

  test("serializes concurrent writes so scheduled tasks are not lost", async () => {
    let nextId = 0;
    const store = new PlanifyStore({ rootDir: dir, now: () => 1_000, createId: () => `task-${nextId++}` });

    await Promise.all([
      store.add({ dueAt: 2_000, sessionFile: "/tmp/a.jsonl", cwd: "/tmp/project", message: "first" }),
      store.add({ dueAt: 3_000, sessionFile: "/tmp/b.jsonl", cwd: "/tmp/project", message: "second" }),
    ]);

    expect((await store.list()).map((task) => task.message).sort()).toEqual(["first", "second"]);
  });

  test("claims only due scheduled tasks and marks them claimed", async () => {
    const store = new PlanifyStore({ rootDir: dir, now: () => 10_000 });
    const due = await store.add({ dueAt: 9_000, sessionFile: "/tmp/a.jsonl", cwd: "/a", message: "due" });
    await store.add({ dueAt: 11_000, sessionFile: "/tmp/b.jsonl", cwd: "/b", message: "future" });

    const claimed = await store.claimDue({ limit: 10, workerId: "worker-1" });

    expect(claimed.map((task) => task.id)).toEqual([due.id]);
    expect((await store.get(due.id))?.status).toBe("claimed");
    expect((await store.get(due.id))?.claimedBy).toBe("worker-1");
  });

  test("requeues stale claimed tasks after a crash window", async () => {
    const store = new PlanifyStore({ rootDir: dir, now: () => 10_000, createId: () => "task-1" });
    await store.add({ dueAt: 9_000, sessionFile: "/tmp/a.jsonl", cwd: "/a", message: "due" });
    await store.claimDue({ limit: 1, workerId: "worker-before-crash" });

    const recovered = new PlanifyStore({ rootDir: dir, now: () => 20_000 });
    const count = await recovered.requeueStaleClaims({ olderThanMs: 5_000 });

    expect(count).toBe(1);
    expect((await recovered.get("task-1"))?.status).toBe("scheduled");
    expect((await recovered.get("task-1"))?.lastError).toContain("stale claim");
  });

  test("cancels scheduled tasks but not claimed tasks", async () => {
    const store = new PlanifyStore({ rootDir: dir, now: () => 10_000 });
    const scheduled = await store.add({ dueAt: 20_000, sessionFile: "/tmp/a.jsonl", cwd: "/a", message: "later" });
    const due = await store.add({ dueAt: 9_000, sessionFile: "/tmp/b.jsonl", cwd: "/b", message: "due" });
    await store.claimDue({ limit: 1, workerId: "worker-1" });

    expect(await store.cancel(scheduled.id)).toBe(true);
    expect(await store.cancel(due.id)).toBe(false);
    expect((await store.get(scheduled.id))?.status).toBe("cancelled");
    expect((await store.get(due.id))?.status).toBe("claimed");
  });

  test("does not mark cancelled tasks delivered or failed", async () => {
    const store = new PlanifyStore({ rootDir: dir, now: () => 10_000, createId: () => "task-1" });
    await store.add({ dueAt: 20_000, sessionFile: "/tmp/a.jsonl", cwd: "/a", message: "later" });
    await store.cancel("task-1");

    expect(await store.markDelivered("task-1")).toBe(false);
    expect(await store.markFailed("task-1", "boom")).toBe(false);
    expect((await store.get("task-1"))?.status).toBe("cancelled");
  });

  test("reschedules recurring tasks after successful delivery", async () => {
    const store = new PlanifyStore({ rootDir: dir, now: () => 10_000, createId: () => "task-1" });
    await store.add({ dueAt: 9_000, sessionFile: "/tmp/a.jsonl", cwd: "/a", message: "repeat", intervalMs: 3_600_000 });
    await store.claimDue({ limit: 1, workerId: "worker-1" });

    expect(await store.markDelivered("task-1")).toBe(true);

    const task = await store.get("task-1");
    expect(task).toEqual(expect.objectContaining({
      status: "scheduled",
      dueAt: 3_610_000,
      runCount: 1,
      attempts: 0,
      deliveredAt: 10_000,
    }));
    expect(task?.claimedAt).toBeUndefined();
    expect(task?.claimedBy).toBeUndefined();
  });

  test("marks recurring tasks delivered when maxRuns is reached", async () => {
    const store = new PlanifyStore({ rootDir: dir, now: () => 10_000, createId: () => "task-1" });
    await store.add({ dueAt: 9_000, sessionFile: "/tmp/a.jsonl", cwd: "/a", message: "repeat", intervalMs: 3_600_000, maxRuns: 1 });
    await store.claimDue({ limit: 1, workerId: "worker-1" });

    expect(await store.markDelivered("task-1")).toBe(true);

    expect(await store.get("task-1")).toEqual(expect.objectContaining({
      status: "delivered",
      runCount: 1,
      deliveredAt: 10_000,
    }));
  });

  test("marks failed recurring tasks failed without rescheduling or keeping claim metadata", async () => {
    const store = new PlanifyStore({ rootDir: dir, now: () => 10_000, createId: () => "task-1" });
    await store.add({ dueAt: 9_000, sessionFile: "/tmp/a.jsonl", cwd: "/a", message: "repeat", intervalMs: 3_600_000 });
    await store.claimDue({ limit: 1, workerId: "worker-1" });

    expect(await store.markFailed("task-1", "boom")).toBe(true);

    const task = await store.get("task-1");
    expect(task).toEqual(expect.objectContaining({
      status: "failed",
      dueAt: 9_000,
      runCount: 0,
      lastError: "boom",
    }));
    expect(task?.claimedAt).toBeUndefined();
    expect(task?.claimedBy).toBeUndefined();
  });
});

describe("scheduled message formatting", () => {
  test("wraps user text with planify context", () => {
    expect(formatScheduledMessage({ id: "task-123", dueAt: 2_000, message: "run the checks" })).toBe(
      `[pi-planify scheduled message]\nIt is time to execute this scheduled task:\n\nrun the checks\n\nWhen finished, reply in this session with a short report stating whether the task succeeded or failed, plus any useful details.\n\nTask ID: task-123\nDue: 1970-01-01T00:00:02.000Z`,
    );
  });

  test("keeps deliveries within the grace period as normal scheduled messages", () => {
    const message = formatScheduledMessage({ id: "task-123", dueAt: 2_000, deliveredAt: 152_000, message: "run the checks" });

    expect(message).toContain("[pi-planify scheduled message]");
    expect(message).not.toContain("[pi-planify missed scheduled task]");
  });

  test("keeps deliveries exactly at the grace boundary as normal scheduled messages", () => {
    const message = formatScheduledMessage({ id: "task-123", dueAt: 2_000, deliveredAt: 302_000, message: "run the checks" });

    expect(message).toContain("[pi-planify scheduled message]");
    expect(message).not.toContain("[pi-planify missed scheduled task]");
  });

  test("turns deliveries past the grace period into a missed-task prompt instead of the original instruction", () => {
    const message = formatScheduledMessage({ id: "task-123", dueAt: 2_000, deliveredAt: 3_725_000, message: "run the checks" });

    expect(message).toContain("[pi-planify missed scheduled task]");
    expect(message).toContain("The scheduled time was missed by more than the allowed grace period.");
    expect(message).toContain("Do not automatically execute the original task as if it were on time.");
    expect(message).toContain("Delivered: 1970-01-01T01:02:05.000Z\nLate by: 1h 2m 3s");
    expect(message).toContain("Original task:\n\nrun the checks");
  });

  test("formats missed-task late durations without zero-value trailing units", () => {
    expect(formatScheduledMessage({ id: "task-123", dueAt: 2_000, deliveredAt: 602_000, message: "run the checks" })).toContain("Late by: 10m");
    expect(formatScheduledMessage({ id: "task-123", dueAt: 2_000, deliveredAt: 3_602_000, message: "run the checks" })).toContain("Late by: 1h");
  });
});

describe("parseWhen", () => {
  test("parses relative minutes and hours", () => {
    expect(parseWhen("in 15m", 1_000)).toBe(901_000);
    expect(parseWhen("in 2h", 1_000)).toBe(7_201_000);
  });

  test("parses ISO timestamps", () => {
    expect(parseWhen("2026-05-26T12:00:00.000Z", 1_000)).toBe(Date.parse("2026-05-26T12:00:00.000Z"));
  });
});

describe("parseInterval", () => {
  test("parses recurring intervals", () => {
    expect(parseInterval("30m")).toBe(1_800_000);
    expect(parseInterval("1h")).toBe(3_600_000);
    expect(parseInterval("2d")).toBe(172_800_000);
  });

  test("rejects invalid intervals", () => {
    expect(() => parseInterval("in 1h")).toThrow(/Could not parse interval/);
    expect(() => parseInterval("0h")).toThrow(/Invalid duration amount/);
  });
});
