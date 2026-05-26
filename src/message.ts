export function formatScheduledMessage(task: { id: string; dueAt: number; message: string }): string {
  return [
    "[pi-planify scheduled message]",
    "C’est le moment d’exécuter cette tâche planifiée :",
    "",
    task.message,
    "",
    `Task ID: ${task.id}`,
    `Due: ${new Date(task.dueAt).toISOString()}`,
  ].join("\n");
}
