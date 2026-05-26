const RELATIVE_PATTERN = /^in\s+(\d+)\s*([mhd])$/iu;

export function parseWhen(input: string, now = Date.now()): number {
  const trimmed = input.trim();
  const relative = RELATIVE_PATTERN.exec(trimmed);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2].toLowerCase();
    const multiplier = unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
    return now + amount * multiplier;
  }

  const parsed = Date.parse(trimmed);
  if (Number.isFinite(parsed)) return parsed;

  throw new Error(`Could not parse scheduled time: ${input}`);
}
