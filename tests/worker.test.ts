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
    await store.add({ dueAt: 9_000, sessionFile: "/tmp/session.jsonl", cwd: "/tmp/project", message: "run tests" });
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
    await store.add({ dueAt: 9_000, sessionFile: "/tmp/session.jsonl", cwd: "/tmp/project", message: "run tests" });

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
});

describe("buildSystemdUnits", () => {
  test("creates a persistent timer and service for run-due", () => {
    const units = buildSystemdUnits({ binPath: "/usr/bin/pi-planify" });

    expect(units.service).toContain("ExecStart=/usr/bin/pi-planify run-due");
    expect(units.timer).toContain("OnCalendar=*:0/1");
    expect(units.timer).toContain("Persistent=true");
  });
});
