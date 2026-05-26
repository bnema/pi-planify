export type ParsedPlanifyCommand =
  | { action: "add"; when: string; message: string }
  | { action: "list" }
  | { action: "cancel"; id: string }
  | { action: "install-service" }
  | { action: "help" };

export function parsePlanifyCommand(input: string): ParsedPlanifyCommand {
  const trimmed = input.trim();
  if (!trimmed || trimmed === "help") return { action: "help" };
  if (trimmed === "list" || trimmed === "status") return { action: "list" };
  if (trimmed === "install-service") return { action: "install-service" };
  if (trimmed.startsWith("cancel ")) {
    const id = trimmed.slice("cancel ".length).trim();
    if (!id) throw new Error("Missing task id.");
    return { action: "cancel", id };
  }

  const parts = splitCommand(trimmed);
  if (parts[0] === "in" && parts.length >= 3) {
    return { action: "add", when: `${parts[0]} ${parts[1]}`, message: parts.slice(2).join(" ") };
  }
  if (parts.length >= 2) {
    return { action: "add", when: parts[0], message: parts.slice(1).join(" ") };
  }

  throw new Error("Usage: /planify in 15m \"message\"");
}

function splitCommand(input: string): string[] {
  const matches = input.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/gu);
  return [...matches].map((match) => match[1] ?? match[2] ?? match[3]).filter(Boolean);
}
