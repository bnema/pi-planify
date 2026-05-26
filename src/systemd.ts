import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { runCommand } from "./command-runner.js";

export interface SystemdUnitOptions {
  binPath: string;
}

export function buildSystemdUnits(options: SystemdUnitOptions): { service: string; timer: string } {
  return {
    service: `[Unit]\nDescription=Deliver due pi-planify scheduled messages\n\n[Service]\nType=oneshot\nExecStart=${options.binPath} run-due\n`,
    timer: `[Unit]\nDescription=Run pi-planify every minute\n\n[Timer]\nOnBootSec=1min\nOnCalendar=*:0/1\nPersistent=true\nUnit=pi-planify.service\n\n[Install]\nWantedBy=timers.target\n`,
  };
}

export async function installSystemdUserTimer(options: SystemdUnitOptions): Promise<void> {
  const dir = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "systemd", "user");
  await mkdir(dir, { recursive: true });
  const units = buildSystemdUnits(options);
  await writeFile(join(dir, "pi-planify.service"), units.service, "utf8");
  await writeFile(join(dir, "pi-planify.timer"), units.timer, "utf8");
  await runCommand("systemctl", ["--user", "daemon-reload"], { cwd: process.cwd() });
  await runCommand("systemctl", ["--user", "enable", "--now", "pi-planify.timer"], { cwd: process.cwd() });
}
