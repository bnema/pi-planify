import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { runCli } from "../src/cli.js";
import type { InstallSchedulerOptions } from "../src/scheduler.js";
import { PlanifyStore } from "../src/store.js";

let dir: string;
let stdout: string[];
let stderr: string[];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pi-planify-cli-"));
  stdout = [];
  stderr = [];
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function run(args: string[]) {
  return runCli([args[0], "--root", dir, ...args.slice(1)], {
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text),
  });
}

describe("runCli", () => {
  test("adds, lists, and cancels scheduled tasks", async () => {
    expect(await run(["add", "--session", "/tmp/session.jsonl", "--cwd", "/tmp/project", "--at", "in 15m", "--message", "run checks"])).toBe(0);
    expect(stdout[0]).toContain("Scheduled");

    stdout = [];
    expect(await run(["list"])).toBe(0);
    expect(stdout.join("\n")).toContain("run checks");

    const taskId = stdout[0].split("\t")[0];
    stdout = [];
    expect(await run(["cancel", taskId])).toBe(0);
    expect(stdout[0]).toBe(`Cancelled ${taskId}`);
  });

  test("adds recurring tasks with an optional maximum run count", async () => {
    const before = Date.now();

    expect(await run(["add", "--session", "/tmp/session.jsonl", "--cwd", "/tmp/project", "--every", "1h", "--max-runs", "3", "--message", "run checks"])).toBe(0);

    const [task] = await new PlanifyStore({ rootDir: dir }).list();
    expect(task).toEqual(expect.objectContaining({ deliveryMode: "headless", intervalMs: 3_600_000, maxRuns: 3, runCount: 0 }));
    expect(task.dueAt).toBeGreaterThanOrEqual(before + 3_600_000);
    expect(task.dueAt).toBeLessThanOrEqual(Date.now() + 3_600_000);
  });

  test("rejects max runs for one-off tasks", async () => {
    expect(await run(["add", "--session", "/tmp/session.jsonl", "--at", "in 15m", "--max-runs", "3", "--message", "run checks"])).toBe(1);
    expect(stderr[0]).toContain("--max-runs requires --every");
  });

  test("runs platform scheduler installation through install-scheduler", async () => {
    let installed: InstallSchedulerOptions | undefined;

    const exitCode = await runCli(["install-scheduler", "--bin", "/usr/local/bin/pi-planify"], {
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
      installScheduler: async (options) => {
        installed = options;
      },
    });

    expect(exitCode).toBe(0);
    expect(installed).toEqual({ binPath: "/usr/local/bin/pi-planify" });
    expect(stdout[0]).toBe("Installed and started pi-planify scheduler.");
  });

  test("keeps install-service as an alias for install-scheduler", async () => {
    let installed: InstallSchedulerOptions | undefined;

    const exitCode = await runCli(["install-service", "--bin", "/usr/local/bin/pi-planify"], {
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
      installScheduler: async (options) => {
        installed = options;
      },
    });

    expect(exitCode).toBe(0);
    expect(installed).toEqual({ binPath: "/usr/local/bin/pi-planify" });
    expect(stdout[0]).toBe("Installed and started pi-planify scheduler.");
  });

  test("returns errors for missing arguments and invalid times", async () => {
    expect(await run(["add", "--session", "/tmp/session.jsonl", "--at", "not-a-time", "--message", "run checks"])).toBe(1);
    expect(stderr[0]).toContain("Could not parse scheduled time");

    stderr = [];
    expect(await run(["cancel"])).toBe(1);
    expect(stderr[0]).toContain("Missing task id");
  });
});
