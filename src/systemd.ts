import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { type CommandRunner, requireSuccessfulCommand, runCommand } from "./command-runner.js";
import { requireAbsolutePath } from "./path-utils.js";

export interface SystemdUnitOptions {
  binPath: string;
}

export interface InstallSystemdOptions extends SystemdUnitOptions {
  exec?: CommandRunner;
}

export function buildSystemdUnits(options: SystemdUnitOptions): { service: string; timer: string } {
  const binPath = requireAbsoluteBinPath(options.binPath);
  return {
    service: `[Unit]\nDescription=Deliver due pi-planify scheduled messages\n\n[Service]\nType=oneshot\nExecStart=${binPath} run-due\n`,
    timer: `[Unit]\nDescription=Run pi-planify every minute\n\n[Timer]\nOnBootSec=1min\nOnCalendar=*:0/1\nPersistent=true\nUnit=pi-planify.service\n\n[Install]\nWantedBy=timers.target\n`,
  };
}

export async function installSystemdUserTimer(options: InstallSystemdOptions): Promise<void> {
  const dir = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "systemd", "user");
  await mkdir(dir, { recursive: true });
  const units = buildSystemdUnits(options);
  const exec = options.exec ?? runCommand;
  await writeFile(join(dir, "pi-planify.service"), units.service, "utf8");
  await writeFile(join(dir, "pi-planify.timer"), units.timer, "utf8");
  requireSuccessfulCommand("systemctl --user daemon-reload", await exec("systemctl", ["--user", "daemon-reload"], { cwd: process.cwd() }));
  requireSuccessfulCommand("systemctl --user enable --now pi-planify.timer", await exec("systemctl", ["--user", "enable", "--now", "pi-planify.timer"], { cwd: process.cwd() }));
}

function requireAbsoluteBinPath(binPath: string): string {
  return requireAbsolutePath(binPath, "pi-planify systemd service requires an absolute executable path");
}
