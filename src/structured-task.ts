export interface StructuredTaskInput {
  message?: string;
  title?: string;
  objective?: string;
  context?: string;
  steps?: string[];
  acceptanceCriteria?: string[];
}

export function buildScheduledTaskMessage(input: StructuredTaskInput): string {
  const sections: string[] = [];
  const title = clean(input.title);
  if (title) sections.push(title);

  appendSection(sections, "Objective", input.objective);
  appendSection(sections, "Context", input.context);

  const steps = cleanList(input.steps);
  if (steps.length > 0) {
    sections.push(`Steps:\n${steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}`);
  }

  const acceptanceCriteria = cleanList(input.acceptanceCriteria);
  if (acceptanceCriteria.length > 0) {
    sections.push(`Acceptance criteria:\n${acceptanceCriteria.map((criterion) => `- ${criterion}`).join("\n")}`);
  }

  if (sections.length > 0) return sections.join("\n\n");

  const message = clean(input.message);
  if (!message) throw new Error("Scheduled task message cannot be empty.");
  return message;
}

function appendSection(sections: string[], title: string, value: string | undefined): void {
  const text = clean(value);
  if (text) sections.push(`${title}:\n${text}`);
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function cleanList(values: string[] | undefined): string[] {
  return (values ?? []).map((value) => value.trim()).filter(Boolean);
}
