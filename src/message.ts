const MISSED_TASK_GRACE_MS = 5 * 60_000;

export function formatScheduledMessage(task: { id: string; dueAt: number; deliveredAt?: number; message: string }): string {
  const deliveredAt = task.deliveredAt;
  if (deliveredAt !== undefined && deliveredAt - task.dueAt > MISSED_TASK_GRACE_MS) return formatMissedScheduledMessage(task, deliveredAt);

  return [
    "[pi-planify scheduled message]",
    "It is time to execute this scheduled task:",
    "",
    task.message,
    "",
    "When finished, reply in this session with a short report stating whether the task succeeded or failed, plus any useful details.",
    "",
    `Task ID: ${task.id}`,
    `Due: ${new Date(task.dueAt).toISOString()}`,
  ].join("\n");
}

function formatMissedScheduledMessage(task: { id: string; dueAt: number; message: string }, deliveredAt: number): string {
  return [
    "[pi-planify missed scheduled task]",
    "The scheduled time was missed by more than the allowed grace period.",
    "Do not automatically execute the original task as if it were on time.",
    "Ask the user what to do next, or decide whether it is still safe before taking action.",
    "",
    "Original task:",
    "",
    task.message,
    "",
    `Task ID: ${task.id}`,
    `Due: ${new Date(task.dueAt).toISOString()}`,
    `Delivered: ${new Date(deliveredAt).toISOString()}`,
    `Late by: ${formatDuration(deliveredAt - task.dueAt)}`,
  ].join("\n");
}

function formatDuration(ms: number): string {
  let remainingSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(remainingSeconds / 3600);
  remainingSeconds -= hours * 3600;
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds - minutes * 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
  return parts.join(" ");
}
