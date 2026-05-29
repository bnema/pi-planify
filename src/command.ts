export type ParsedPlanifyCommand =
  | { action: "add"; when?: string; every?: string; maxRuns?: number; message: string }
  | { action: "list" }
  | { action: "cancel"; id: string }
  | { action: "install-scheduler" }
  | { action: "install-service" }
  | { action: "help" };

export function parsePlanifyCommand(input: string): ParsedPlanifyCommand {
  const trimmed = input.trim();
  if (!trimmed || trimmed === "help") return { action: "help" };
  if (trimmed === "list" || trimmed === "status") return { action: "list" };
  if (trimmed === "install-scheduler") return { action: "install-scheduler" };
  if (trimmed === "install-service") return { action: "install-service" };
  if (trimmed.startsWith("cancel ")) {
    const id = trimmed.slice("cancel ".length).trim();
    if (!id) throw new Error("Missing task id.");
    return { action: "cancel", id };
  }

  const parts = splitCommand(trimmed);
  const parsed = parseAddParts(parts);
  if (parsed) return parsed;

  throw new Error("Usage: /planify in 15m \"message\", /planify every 1h \"message\", or /planify in 10m every 1h max 5 \"message\"");
}

function parseAddParts(parts: string[]): ParsedPlanifyCommand | undefined {
  if (parts.length < 2) return undefined;

  let index = 0;
  let when: string | undefined;
  let every: string | undefined;
  let maxRuns: number | undefined;

  if (parts[index] === "in" && parts[index + 1]) {
    when = `${parts[index]} ${parts[index + 1]}`;
    index += 2;
  } else if (parts[index] !== "every") {
    when = parts[index];
    index += 1;
  }

  if (parts[index] === "every" && parts[index + 1]) {
    every = parts[index + 1];
    index += 2;
  }

  if ((parts[index] === "max" || parts[index] === "max-runs" || parts[index] === "maxRuns") && parts[index + 1]) {
    maxRuns = Number(parts[index + 1]);
    if (!Number.isSafeInteger(maxRuns) || maxRuns <= 0) throw new Error("maxRuns must be a positive integer.");
    index += 2;
  }

  const message = parts.slice(index).join(" ");
  if (!message.trim()) return undefined;
  return {
    action: "add",
    ...(when === undefined ? {} : { when }),
    ...(every === undefined ? {} : { every }),
    ...(maxRuns === undefined ? {} : { maxRuns }),
    message,
  };
}

function splitCommand(input: string): string[] {
  const matches = input.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/gu);
  return [...matches].map((match) => match[1] ?? match[2] ?? match[3]).filter(Boolean);
}
