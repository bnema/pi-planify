import { type CommandRunner } from "./command-runner.js";
import { installLaunchdUserAgent } from "./launchd.js";
import { installSystemdUserTimer } from "./systemd.js";
import { installWindowsScheduledTask } from "./windows-task.js";

export interface InstallSchedulerOptions {
  binPath: string;
  nodePath?: string;
  platform?: NodeJS.Platform | string;
  exec?: CommandRunner;
}

export interface SchedulerInstaller {
  name: string;
  install(options: InstallSchedulerOptions): Promise<void>;
}

const SYSTEMD_INSTALLER: SchedulerInstaller = {
  name: "systemd",
  install: installSystemdUserTimer,
};

const LAUNCHD_INSTALLER: SchedulerInstaller = {
  name: "launchd",
  install: installLaunchdUserAgent,
};

const WINDOWS_TASK_INSTALLER: SchedulerInstaller = {
  name: "windows-task-scheduler",
  install: installWindowsScheduledTask,
};

export function selectSchedulerInstaller(platform: NodeJS.Platform | string = process.platform): SchedulerInstaller {
  switch (platform) {
    case "linux":
      return SYSTEMD_INSTALLER;
    case "darwin":
      return LAUNCHD_INSTALLER;
    case "win32":
      return WINDOWS_TASK_INSTALLER;
    default:
      throw new Error(`Unsupported platform for pi-planify scheduler installation: ${platform}`);
  }
}

export async function installPlatformScheduler(options: InstallSchedulerOptions): Promise<void> {
  await selectSchedulerInstaller(options.platform).install(options);
}
