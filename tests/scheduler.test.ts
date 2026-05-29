import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import type { CommandRunner } from "../src/command-runner.js";
import { buildLaunchdAgentPlist, installLaunchdUserAgent } from "../src/launchd.js";
import { installSystemdUserTimer } from "../src/systemd.js";
import { buildWindowsTaskSchedulerCommand, installWindowsScheduledTask } from "../src/windows-task.js";
import { selectSchedulerInstaller } from "../src/scheduler.js";

let dirsToRemove: string[] = [];

afterEach(async () => {
  await Promise.all(dirsToRemove.map((dir) => rm(dir, { recursive: true, force: true })));
  dirsToRemove = [];
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirsToRemove.push(dir);
  return dir;
}

function recordingExec(calls: Array<{ command: string; args: string[]; cwd: string }>, exitCode = 0): CommandRunner {
  return async (command, args, options) => {
    calls.push({ command, args, cwd: options.cwd });
    return { exitCode, stdout: "", stderr: exitCode === 0 ? "" : "boom" };
  };
}

describe("selectSchedulerInstaller", () => {
  test("selects a platform-specific scheduler installer", () => {
    expect(selectSchedulerInstaller("linux").name).toBe("systemd");
    expect(selectSchedulerInstaller("darwin").name).toBe("launchd");
    expect(selectSchedulerInstaller("win32").name).toBe("windows-task-scheduler");
  });

  test("rejects unsupported platforms", () => {
    expect(() => selectSchedulerInstaller("freebsd")).toThrow(/Unsupported platform/);
  });
});

describe("installSystemdUserTimer", () => {
  test("writes systemd units and enables the timer", async () => {
    const configHome = await tempDir("pi-planify-systemd-");
    const previousConfigHome = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = configHome;
    const calls: Array<{ command: string; args: string[]; cwd: string }> = [];

    try {
      await installSystemdUserTimer({ binPath: "/usr/bin/pi-planify", exec: recordingExec(calls) });
    } finally {
      if (previousConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousConfigHome;
    }

    await expect(readFile(join(configHome, "systemd", "user", "pi-planify.service"), "utf8")).resolves.toContain("ExecStart=/usr/bin/pi-planify run-due");
    await expect(readFile(join(configHome, "systemd", "user", "pi-planify.timer"), "utf8")).resolves.toContain("OnCalendar=*:0/1");
    expect(calls.map((call) => [call.command, call.args])).toEqual([
      ["systemctl", ["--user", "daemon-reload"]],
      ["systemctl", ["--user", "enable", "--now", "pi-planify.timer"]],
    ]);
  });

  test("throws when systemctl exits non-zero", async () => {
    await expect(installSystemdUserTimer({ binPath: "/usr/bin/pi-planify", exec: recordingExec([], 1) })).rejects.toThrow(/systemctl --user daemon-reload failed: boom/);
  });
});

describe("buildLaunchdAgentPlist", () => {
  test("creates a user LaunchAgent that runs run-due every minute", () => {
    const plist = buildLaunchdAgentPlist({
      label: "works.earendil.pi-planify",
      nodePath: "/usr/local/bin/node",
      scriptPath: "/Users/example/Library/Application Support/pi-planify/bin/pi-planify.mjs",
      logDir: "/Users/example/Library/Logs/pi-planify",
    });

    expect(plist).toContain("<key>Label</key>");
    expect(plist).toContain("<string>works.earendil.pi-planify</string>");
    expect(plist).toContain("<string>/usr/local/bin/node</string>");
    expect(plist).toContain("<string>/Users/example/Library/Application Support/pi-planify/bin/pi-planify.mjs</string>");
    expect(plist).toContain("<string>run-due</string>");
    expect(plist).toContain("<key>StartInterval</key>");
    expect(plist).toContain("<integer>60</integer>");
    expect(plist).toContain("<key>RunAtLoad</key>");
    expect(plist).toContain("<true/>");
    expect(plist).toContain("<key>StandardOutPath</key>");
    expect(plist).toContain("/Users/example/Library/Logs/pi-planify/launchd.out.log");
    expect(plist).toContain("<key>StandardErrorPath</key>");
    expect(plist).toContain("/Users/example/Library/Logs/pi-planify/launchd.err.log");
  });

  test("escapes XML special characters in paths", () => {
    const plist = buildLaunchdAgentPlist({
      label: "works.earendil.pi-planify",
      nodePath: "/opt/node&tools/bin/node",
      scriptPath: "/Users/example/<planify>/pi-planify.mjs",
      logDir: "/Users/example/Library/Logs/pi-planify",
    });

    expect(plist).toContain("/opt/node&amp;tools/bin/node");
    expect(plist).toContain("/Users/example/&lt;planify&gt;/pi-planify.mjs");
  });
});

describe("installLaunchdUserAgent", () => {
  test("writes a LaunchAgent and bootstraps it", async () => {
    const root = await tempDir("pi-planify-launchd-");
    const agentsDir = join(root, "LaunchAgents");
    const logDir = join(root, "Logs");
    const calls: Array<{ command: string; args: string[]; cwd: string }> = [];

    await installLaunchdUserAgent({
      binPath: "/usr/local/bin/pi-planify.mjs",
      nodePath: "/usr/local/bin/node",
      agentsDir,
      logDir,
      uid: 501,
      exec: recordingExec(calls),
    });

    const plistPath = join(agentsDir, "works.earendil.pi-planify.plist");
    await expect(readFile(plistPath, "utf8")).resolves.toContain("<string>/usr/local/bin/pi-planify.mjs</string>");
    expect(calls.map((call) => [call.command, call.args])).toEqual([
      ["launchctl", ["bootout", "gui/501/works.earendil.pi-planify"]],
      ["launchctl", ["bootstrap", "gui/501", plistPath]],
      ["launchctl", ["enable", "gui/501/works.earendil.pi-planify"]],
    ]);
  });

  test("tolerates missing job during launchd bootout", async () => {
    const root = await tempDir("pi-planify-launchd-");
    const calls: Array<{ command: string; args: string[]; cwd: string }> = [];

    await installLaunchdUserAgent({
      binPath: "/usr/local/bin/pi-planify.mjs",
      nodePath: "/usr/local/bin/node",
      agentsDir: join(root, "LaunchAgents"),
      logDir: join(root, "Logs"),
      uid: 501,
      exec: async (command, args, options) => {
        calls.push({ command, args, cwd: options.cwd });
        if (args[0] === "bootout") return { exitCode: 3, stdout: "", stderr: "No such process" };
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });

    expect(calls).toHaveLength(3);
  });

  test("throws when launchd bootstrap exits non-zero", async () => {
    const root = await tempDir("pi-planify-launchd-");

    await expect(installLaunchdUserAgent({
      binPath: "/usr/local/bin/pi-planify.mjs",
      nodePath: "/usr/local/bin/node",
      agentsDir: join(root, "LaunchAgents"),
      logDir: join(root, "Logs"),
      uid: 501,
      exec: async (_command, args) => args[0] === "bootstrap"
        ? { exitCode: 5, stdout: "", stderr: "bad plist" }
        : { exitCode: 0, stdout: "", stderr: "" },
    })).rejects.toThrow(/launchctl bootstrap failed: bad plist/);
  });
});

describe("installWindowsScheduledTask", () => {
  test("creates the Windows scheduled task", async () => {
    const calls: Array<{ command: string; args: string[]; cwd: string }> = [];

    await installWindowsScheduledTask({
      nodePath: "C:\\Program Files\\nodejs\\node.exe",
      binPath: "C:\\Users\\Example User\\pi-planify.mjs",
      exec: recordingExec(calls),
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe("schtasks.exe");
    expect(calls[0].args).toContain("/Create");
    expect(calls[0].args).toContain('"C:\\\\Program Files\\\\nodejs\\\\node.exe" "C:\\\\Users\\\\Example User\\\\pi-planify.mjs" run-due');
  });

  test("throws when schtasks exits non-zero", async () => {
    await expect(installWindowsScheduledTask({
      nodePath: "C:\\Program Files\\nodejs\\node.exe",
      binPath: "C:\\Users\\Example User\\pi-planify.mjs",
      exec: recordingExec([], 1),
    })).rejects.toThrow(/schtasks\.exe failed: boom/);
  });
});

describe("buildWindowsTaskSchedulerCommand", () => {
  test("creates a per-minute schtasks command using explicit node and script paths", () => {
    const command = buildWindowsTaskSchedulerCommand({
      taskName: "pi-planify",
      nodePath: "C:\\Program Files\\nodejs\\node.exe",
      scriptPath: "C:\\Users\\Example User\\AppData\\Roaming\\npm\\node_modules\\pi-planify\\bin\\pi-planify.mjs",
    });

    expect(command.command).toBe("schtasks.exe");
    expect(command.args).toEqual([
      "/Create",
      "/TN",
      "pi-planify",
      "/SC",
      "MINUTE",
      "/MO",
      "1",
      "/TR",
      '"C:\\\\Program Files\\\\nodejs\\\\node.exe" "C:\\\\Users\\\\Example User\\\\AppData\\\\Roaming\\\\npm\\\\node_modules\\\\pi-planify\\\\bin\\\\pi-planify.mjs" run-due',
      "/F",
    ]);
  });

  test("escapes Windows paths ending with backslashes", () => {
    const command = buildWindowsTaskSchedulerCommand({
      taskName: "pi-planify",
      nodePath: "C:\\Tools\\",
      scriptPath: "C:\\Planify\\",
    });

    expect(command.args).toContain('"C:\\\\Tools\\\\" "C:\\\\Planify\\\\" run-due');
  });

  test("escapes consecutive backslashes before quotes", () => {
    const command = buildWindowsTaskSchedulerCommand({
      taskName: "pi-planify",
      nodePath: 'C:\\Tools\\\\"node.exe',
      scriptPath: "C:\\Planify\\pi-planify.mjs",
    });

    expect(command.args).toContain('"C:\\\\Tools\\\\\\\\\\"node.exe" "C:\\\\Planify\\\\pi-planify.mjs" run-due');
  });
});
