import { fileURLToPath } from "node:url";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";

import { parsePlanifyCommand } from "../src/command.js";
import { defaultPlanifyRoot } from "../src/paths.js";
import { PlanifyStore } from "../src/store.js";
import { buildScheduledTaskMessage } from "../src/structured-task.js";
import { installSystemdUserTimer } from "../src/systemd.js";
import { parseInterval, parseWhen } from "../src/time.js";

const TOOL_NAME = "planify";
const STATUS_KEY = "pi-planify";
const PLANIFY_BIN_PATH = fileURLToPath(new URL("../bin/pi-planify.mjs", import.meta.url));

const PlanifyParamsSchema = Type.Object({
  when: Type.Optional(Type.String({ description: "When to deliver the first message, for example 'in 30m', 'in 2h', or an ISO timestamp. Optional when every is set." })),
  every: Type.Optional(Type.String({ description: "Recurring interval, for example '30m', '1h', or '1d'. If when is omitted, the first run happens after one interval." })),
  maxRuns: Type.Optional(Type.Integer({ description: "Maximum number of successful recurring deliveries. Omit for indefinite recurrence until cancelled." })),
  message: Type.Optional(Type.String({ description: "Plain message to deliver. Use structured fields instead when the task has objective/context/steps." })),
  title: Type.Optional(Type.String({ description: "Short task title for the future agent turn." })),
  objective: Type.Optional(Type.String({ description: "Concrete outcome the future agent should achieve." })),
  context: Type.Optional(Type.String({ description: "Relevant context the future agent will need at delivery time." })),
  steps: Type.Optional(Type.Array(Type.String(), { description: "Suggested execution steps for the future agent." })),
  acceptanceCriteria: Type.Optional(Type.Array(Type.String(), { description: "Checks that define successful completion." })),
});

type PlanifyParams = Static<typeof PlanifyParamsSchema>;

function store(): PlanifyStore {
  return new PlanifyStore({ rootDir: defaultPlanifyRoot() });
}

function requireSessionFile(ctx: ExtensionContext): string {
  const sessionFile = ctx.sessionManager.getSessionFile();
  if (!sessionFile) throw new Error("pi-planify requires a persisted Pi session. Start Pi without --no-session.");
  return sessionFile;
}

async function schedule(ctx: ExtensionContext, options: { when?: string; every?: string; maxRuns?: number; message: string }): Promise<string> {
  if (!options.when && !options.every) throw new Error("Missing when or every.");
  const intervalMs = options.every === undefined ? undefined : parseInterval(options.every);
  const maxRuns = validateOptionalPositiveInteger(options.maxRuns, "maxRuns");
  const task = await store().add({
    dueAt: options.when ? parseWhen(options.when) : Date.now() + (intervalMs ?? 0),
    sessionFile: requireSessionFile(ctx),
    cwd: ctx.cwd,
    message: options.message,
    intervalMs,
    maxRuns,
  });
  return `Scheduled ${task.id} for ${new Date(task.dueAt).toISOString()}`;
}

async function listTasks(): Promise<string> {
  const tasks = await store().list();
  const active = tasks.filter((task) => task.status === "scheduled" || task.status === "claimed");
  if (active.length === 0) return "No active pi-planify tasks.";
  return active.map((task) => {
    const recurrence = task.intervalMs === undefined ? "" : ` · every ${formatInterval(task.intervalMs)}${task.maxRuns === undefined ? "" : ` · ${task.runCount}/${task.maxRuns} runs`}`;
    return `${task.id} · ${task.status} · ${new Date(task.dueAt).toISOString()}${recurrence} · ${task.message}`;
  }).join("\n");
}

function validateOptionalPositiveInteger(value: number | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`);
  return value;
}

function formatInterval(intervalMs: number): string {
  if (intervalMs % 86_400_000 === 0) return `${intervalMs / 86_400_000}d`;
  if (intervalMs % 3_600_000 === 0) return `${intervalMs / 3_600_000}h`;
  return `${intervalMs / 60_000}m`;
}

function helpText(): string {
  return [
    "Usage:",
    '/planify in 30m "check the test results"',
    '/planify every 1h "check the test results"',
    '/planify in 10m every 1h max 5 "check the test results"',
    "/planify list",
    "/planify cancel <task-id>",
    "/planify install-service",
  ].join("\n");
}

export default function planifyExtension(pi: ExtensionAPI): void {
  pi.registerCommand("planify", {
    description: "Schedule a message for reliable future delivery into this Pi session.",
    handler: async (args, ctx) => {
      try {
        const parsed = parsePlanifyCommand(args);
        switch (parsed.action) {
          case "add": {
            const message = await schedule(ctx, parsed);
            ctx.ui.notify(message, "info");
            ctx.ui.setStatus(STATUS_KEY, "scheduled message");
            return;
          }
          case "list":
            ctx.ui.notify(await listTasks(), "info");
            return;
          case "cancel":
            ctx.ui.notify((await store().cancel(parsed.id)) ? `Cancelled ${parsed.id}` : `Could not cancel ${parsed.id}`, "info");
            return;
          case "install-service":
            await installSystemdUserTimer({ binPath: PLANIFY_BIN_PATH });
            ctx.ui.notify("Installed and started pi-planify user timer.", "info");
            return;
          case "help":
            ctx.ui.notify(helpText(), "info");
            return;
        }
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });

  pi.registerTool({
    name: TOOL_NAME,
    label: "Planify",
    description: "Schedule a message for reliable future delivery into the current Pi session.",
    promptSnippet: "Schedule deferred messages into the current Pi session.",
    promptGuidelines: [
      "Use planify only when the user explicitly asks to schedule, remind later, or run something at a future time.",
      "The planify tool always schedules a user message into the current Pi session; do not ask the user to choose reminder versus auto-run modes.",
      "For recurring tasks, set every to an interval such as '1h' and optionally maxRuns to limit successful deliveries.",
      "For multi-step tasks, prefer structured fields: title, objective, context, steps, and acceptanceCriteria instead of cramming everything into message.",
      "Prefer concise scheduled messages that include enough context for the future agent turn to act correctly.",
    ],
    parameters: PlanifyParamsSchema,
    async execute(_toolCallId, params: PlanifyParams, _signal, _onUpdate, ctx) {
      const scheduledMessage = buildScheduledTaskMessage(params);
      const message = await schedule(ctx, { when: params.when, every: params.every, maxRuns: params.maxRuns, message: scheduledMessage });
      return { content: [{ type: "text", text: message }], details: { scheduled: true } };
    },
  });
}
