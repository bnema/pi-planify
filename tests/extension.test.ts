import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import planifyExtension from "../extensions/index.js";

type RegisteredCommand = { handler: (args: string, ctx: FakeContext) => Promise<void> };
type RegisteredTool = { execute: (toolCallId: string, params: Record<string, unknown>, signal: AbortSignal | undefined, onUpdate: undefined, ctx: FakeContext) => Promise<{ content: Array<{ type: string; text: string }> }> };

type FakeContext = {
  cwd: string;
  sessionManager: { getSessionFile: () => string };
  ui: { notifications: string[]; statuses: string[]; notify: (message: string) => void; setStatus: (_key: string, text: string) => void };
};

let dir: string;
let previousAgentDir: string | undefined;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pi-planify-extension-"));
  previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
});

afterEach(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(dir, { recursive: true, force: true });
});

function setup() {
  const commands = new Map<string, RegisteredCommand>();
  const tools = new Map<string, RegisteredTool>();
  planifyExtension({
    registerCommand: (name: string, command: RegisteredCommand) => commands.set(name, command),
    registerTool: (tool: RegisteredTool & { name: string }) => tools.set(tool.name, tool),
  } as never);

  const ctx: FakeContext = {
    cwd: "/tmp/project",
    sessionManager: { getSessionFile: () => "/tmp/session.jsonl" },
    ui: {
      notifications: [],
      statuses: [],
      notify(message: string) {
        this.notifications.push(message);
      },
      setStatus(_key: string, text: string) {
        this.statuses.push(text);
      },
    },
  };

  return { commands, tools, ctx };
}

describe("planify extension", () => {
  test("registers /planify and schedules through the command", async () => {
    const { commands, ctx } = setup();

    await commands.get("planify")?.handler('in 15m "run checks"', ctx);

    expect(ctx.ui.notifications[0]).toContain("Scheduled");
    expect(ctx.ui.statuses).toContain("scheduled message");
  });

  test("registers the planify tool with structured task fields", async () => {
    const { tools, ctx } = setup();

    const result = await tools.get("planify")?.execute("tool-1", {
      when: "in 15m",
      title: "Run checks",
      objective: "Run the project checks and report the result.",
      acceptanceCriteria: ["Checks complete", "Result is reported"],
    }, undefined, undefined, ctx);

    expect(result?.content[0].text).toContain("Scheduled");
  });
});
