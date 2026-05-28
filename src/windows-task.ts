import { win32 } from "node:path";
import { type CommandRunner, requireSuccessfulCommand, runCommand } from "./command-runner.js";
import { requireAbsolutePath as requireAbsolutePathWith } from "./path-utils.js";

const DEFAULT_TASK_NAME = "pi-planify";

export interface WindowsTaskSchedulerCommandOptions {
  taskName: string;
  nodePath: string;
  scriptPath: string;
}

export interface WindowsTaskSchedulerCommand {
  command: string;
  args: string[];
}

export interface InstallWindowsScheduledTaskOptions {
  binPath: string;
  nodePath?: string;
  exec?: CommandRunner;
}

export function buildWindowsTaskSchedulerCommand(options: WindowsTaskSchedulerCommandOptions): WindowsTaskSchedulerCommand {
  return {
    command: "schtasks.exe",
    args: [
      "/Create",
      "/TN",
      options.taskName,
      "/SC",
      "MINUTE",
      "/MO",
      "1",
      "/TR",
      `${quoteWindowsTaskRunArg(options.nodePath)} ${quoteWindowsTaskRunArg(options.scriptPath)} run-due`,
      "/F",
    ],
  };
}

export async function installWindowsScheduledTask(options: InstallWindowsScheduledTaskOptions): Promise<void> {
  const nodePath = requireAbsolutePath(options.nodePath ?? process.execPath, "pi-planify Windows scheduled task requires an absolute node path");
  const scriptPath = requireAbsolutePath(options.binPath, "pi-planify Windows scheduled task requires an absolute script path");
  const task = buildWindowsTaskSchedulerCommand({ taskName: DEFAULT_TASK_NAME, nodePath, scriptPath });
  requireSuccessfulCommand(task.command, await (options.exec ?? runCommand)(task.command, task.args, { cwd: process.cwd() }));
}

function requireAbsolutePath(path: string, message: string): string {
  return requireAbsolutePathWith(path, message, win32.isAbsolute);
}

function quoteWindowsTaskRunArg(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}
