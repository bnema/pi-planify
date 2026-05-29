import { spawn } from "node:child_process";

export interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (command: string, args: string[], options: { cwd: string }) => Promise<CommandResult>;

export async function runCommand(command: string, args: string[], options: { cwd: string }): Promise<CommandResult> {
  return await new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("exit", (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}

export function requireSuccessfulCommand(command: string, result: CommandResult): void {
  if (result.exitCode === 0) return;
  const detail = result.stderr.trim() || result.stdout.trim() || (result.exitCode == null ? "terminated before reporting an exit code" : `exited with code ${result.exitCode}`);
  throw new Error(`${command} failed: ${detail}`);
}
