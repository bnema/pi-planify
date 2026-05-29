import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { type CommandResult, type CommandRunner, requireSuccessfulCommand, runCommand } from "./command-runner.js";
import { requireAbsolutePath } from "./path-utils.js";

const DEFAULT_LABEL = "works.earendil.pi-planify";

export interface LaunchdPlistOptions {
  label: string;
  nodePath: string;
  scriptPath: string;
  logDir: string;
}

export interface InstallLaunchdOptions {
  binPath: string;
  nodePath?: string;
  exec?: CommandRunner;
  agentsDir?: string;
  logDir?: string;
  uid?: number | string;
}

export function buildLaunchdAgentPlist(options: LaunchdPlistOptions): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(options.label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(options.nodePath)}</string>
    <string>${escapeXml(options.scriptPath)}</string>
    <string>run-due</string>
  </array>
  <key>StartInterval</key>
  <integer>60</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(join(options.logDir, "launchd.out.log"))}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(join(options.logDir, "launchd.err.log"))}</string>
</dict>
</plist>
`;
}

export async function installLaunchdUserAgent(options: InstallLaunchdOptions): Promise<void> {
  const scriptPath = requireAbsolutePath(options.binPath, "pi-planify launchd agent requires an absolute script path");
  const nodePath = requireAbsolutePath(options.nodePath ?? process.execPath, "pi-planify launchd agent requires an absolute node path");
  const exec = options.exec ?? runCommand;
  const label = DEFAULT_LABEL;
  const agentsDir = options.agentsDir ?? join(homedir(), "Library", "LaunchAgents");
  const logDir = options.logDir ?? join(homedir(), "Library", "Logs", "pi-planify");
  const plistPath = join(agentsDir, `${label}.plist`);
  const domain = `gui/${options.uid ?? currentUid()}`;

  await mkdir(agentsDir, { recursive: true });
  await mkdir(logDir, { recursive: true });
  await writeFile(plistPath, buildLaunchdAgentPlist({ label, nodePath, scriptPath, logDir }), "utf8");

  tolerateMissingLaunchdJob(await exec("launchctl", ["bootout", `${domain}/${label}`], { cwd: process.cwd() }));
  requireSuccessfulCommand("launchctl bootstrap", await exec("launchctl", ["bootstrap", domain, plistPath], { cwd: process.cwd() }));
  requireSuccessfulCommand("launchctl enable", await exec("launchctl", ["enable", `${domain}/${label}`], { cwd: process.cwd() }));
}

function currentUid(): number | string {
  if (typeof process.getuid !== "function") throw new Error("Could not determine current user id for launchd scheduler installation.");
  return process.getuid();
}

function tolerateMissingLaunchdJob(result: CommandResult): void {
  if (result.exitCode === 0) return;
  if (/(no such process|could not find service|couldn't find service|service not found)/iu.test(result.stderr)) return;
  requireSuccessfulCommand("launchctl bootout", result);
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
