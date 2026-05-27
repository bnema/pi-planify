const RELATIVE_PATTERN = /^in\s+(\d+)\s*([mhd])$/iu;
const INTERVAL_PATTERN = /^(\d+)\s*([mhd])$/iu;

export function parseWhen(input: string, now = Date.now()): number {
  const trimmed = input.trim();
  const relative = RELATIVE_PATTERN.exec(trimmed);
  if (relative) return now + parseDurationParts(relative[1], relative[2]);

  const parsed = Date.parse(trimmed);
  if (Number.isFinite(parsed)) return parsed;

  throw new Error(`Could not parse scheduled time: ${input}`);
}

export function parseInterval(input: string): number {
  const trimmed = input.trim();
  const interval = INTERVAL_PATTERN.exec(trimmed);
  if (!interval) throw new Error(`Could not parse interval: ${input}`);
  return parseDurationParts(interval[1], interval[2]);
}

function parseDurationParts(amountText: string, unitText: string): number {
  const amount = Number(amountText);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error(`Invalid duration amount: ${amountText}`);
  const unit = unitText.toLowerCase();
  const multiplier = unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  return amount * multiplier;
}
