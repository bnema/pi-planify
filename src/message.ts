export function formatScheduledMessage(task: { id: string; dueAt: number; message: string }): string {
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
