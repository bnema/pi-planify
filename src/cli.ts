import { resolve } from "node:path";

import { deliverDueTasks } from "./delivery.js";
import { defaultPlanifyRoot } from "./paths.js";
import { PlanifyStore } from "./store.js";
import { installSystemdUserTimer } from "./systemd.js";
import { parseInterval, parseWhen } from "./time.js";

interface ParsedArgs {
  command: string;
  flags: Map<string, string>;
  positionals: string[];
}

export async function runCli(argv: string[], options: { stdout?: (text: string) => void; stderr?: (text: string) => void } = {}): Promise<number> {
  const out = options.stdout ?? ((text) => process.stdout.write(`${text}\n`));
  const err = options.stderr ?? ((text) => process.stderr.write(`${text}\n`));

  try {
    const parsed = parseArgs(argv);
    const rootDir = parsed.flags.get("root") ?? defaultPlanifyRoot();
    const store = new PlanifyStore({ rootDir });

    switch (parsed.command) {
      case "add": {
        const sessionFile = requireFlag(parsed, "session");
        const cwd = parsed.flags.get("cwd") ?? process.cwd();
        const at = parsed.flags.get("at");
        const every = parsed.flags.get("every");
        if (!at && !every) throw new Error("Missing --at or --every.");
        const intervalMs = every === undefined ? undefined : parseInterval(every);
        const maxRuns = parseOptionalPositiveInteger(parsed.flags.get("max-runs"), "max-runs");
        if (intervalMs === undefined && parsed.flags.has("max-runs")) throw new Error("--max-runs requires --every.");
        const message = parsed.flags.get("message") ?? parsed.positionals.join(" ");
        if (!message.trim()) throw new Error("Missing --message or positional message.");
        const task = await store.add({
          dueAt: at ? parseWhen(at) : Date.now() + (intervalMs ?? 0),
          sessionFile,
          cwd,
          message,
          deliveryMode: "headless",
          intervalMs,
          maxRuns,
        });
        out(`Scheduled ${task.id} for ${new Date(task.dueAt).toISOString()}`);
        return 0;
      }
      case "list": {
        const tasks = await store.list();
        if (tasks.length === 0) out("No scheduled tasks.");
        else for (const task of tasks) out(`${task.id}\t${task.status}\t${new Date(task.dueAt).toISOString()}\t${task.message}`);
        return 0;
      }
      case "cancel": {
        const id = parsed.positionals[0] ?? parsed.flags.get("id");
        if (!id) throw new Error("Missing task id.");
        out((await store.cancel(id)) ? `Cancelled ${id}` : `Could not cancel ${id}`);
        return 0;
      }
      case "run-due": {
        const summary = await deliverDueTasks({ rootDir, limit: Number(parsed.flags.get("limit") ?? 10) });
        out(`Claimed ${summary.claimed}, delivered ${summary.delivered}, failed ${summary.failed}.`);
        return summary.failed > 0 ? 1 : 0;
      }
      case "install-service": {
        const binPath = parsed.flags.get("bin") ?? resolve(process.argv[1] ?? "pi-planify");
        await installSystemdUserTimer({ binPath });
        out("Installed and started pi-planify user timer.");
        return 0;
      }
      case "help":
      case "":
        out(helpText());
        return 0;
      default:
        throw new Error(`Unknown command: ${parsed.command}`);
    }
  } catch (error) {
    err(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command = "help", ...rest] = argv;
  const flags = new Map<string, string>();
  const positionals: string[] = [];

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = rest[index + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for --${key}`);
      flags.set(key, value);
      index += 1;
    } else {
      positionals.push(arg);
    }
  }

  return { command, flags, positionals };
}

function requireFlag(args: ParsedArgs, name: string): string {
  const value = args.flags.get(name);
  if (!value) throw new Error(`Missing --${name}.`);
  return value;
}

function parseOptionalPositiveInteger(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`--${name} must be a positive integer.`);
  return parsed;
}

function helpText(): string {
  return `pi-planify\n\nCommands:\n  add --session <file> (--at <when> | --every <interval>) [--every <interval>] [--max-runs <count>] [--cwd <dir>] --message <text>\n  list\n  cancel <task-id>\n  run-due\n  install-service [--bin <path>]`;
}
