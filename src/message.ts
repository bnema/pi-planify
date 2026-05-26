export function formatScheduledMessage(task: { id: string; dueAt: number; message: string }): string {
  return [
    "[pi-planify scheduled message]",
    "C’est le moment d’exécuter cette tâche planifiée :",
    "",
    task.message,
    "",
    "Quand tu as terminé, réponds dans cette session avec un court rapport indiquant si la tâche a réussi ou échoué, et les détails utiles.",
    "",
    `Task ID: ${task.id}`,
    `Due: ${new Date(task.dueAt).toISOString()}`,
  ].join("\n");
}
