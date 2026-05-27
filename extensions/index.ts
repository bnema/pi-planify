import { fileURLToPath } from "node:url";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";

import { parsePlanifyCommand } from "../src/command.js";
import { defaultPlanifyRoot } from "../src/paths.js";
import { PlanifyStore } from "../src/store.js";
import { buildScheduledTaskMessage } from "../src/structured-task.js";
import { installSystemdUserTimer } from "../src/systemd.js";
import { parseWhen } from "../src/time.js";

const TOOL_NAME = "planify";
const STATUS_KEY = "pi-planify";
const PLANIFY_BIN_PATH = fileURLToPath(new URL("../bin/pi-planify.mjs", import.meta.url));

const PlanifyParamsSchema = Type.Object({
  when: Type.String({ description: "When to deliver the message, for example 'in 30m', 'in 2h', or an ISO timestamp." }),
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

async function schedule(ctx: ExtensionContext, when: string, message: string): Promise<string> {
  const task = await store().add({
    dueAt: parseWhen(when),
    sessionFile: requireSessionFile(ctx),
    cwd: ctx.cwd,
    message,
  });
  return `Scheduled ${task.id} for ${new Date(task.dueAt).toISOString()}`;
}

async function listTasks(): Promise<string> {
  const tasks = await store().list();
  const active = tasks.filter((task) => task.status === "scheduled" || task.status === "claimed");
  if (active.length === 0) return "No active pi-planify tasks.";
  return active.map((task) => `${task.id} · ${task.status} · ${new Date(task.dueAt).toISOString()} · ${task.message}`).join("\n");
}

function helpText(): string {
  return [
    "Usage:",
    '/planify in 30m "check the test results"',
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
            const message = await schedule(ctx, parsed.when, parsed.message);
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
      "For multi-step tasks, prefer structured fields: title, objective, context, steps, and acceptanceCriteria instead of cramming everything into message.",
      "Prefer concise scheduled messages that include enough context for the future agent turn to act correctly.",
    ],
    parameters: PlanifyParamsSchema,
    async execute(_toolCallId, params: PlanifyParams, _signal, _onUpdate, ctx) {
      const scheduledMessage = buildScheduledTaskMessage(params);
      const message = await schedule(ctx, params.when, scheduledMessage);
      return { content: [{ type: "text", text: message }], details: { scheduled: true } };
    },
  });
}
