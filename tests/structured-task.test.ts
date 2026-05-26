import { describe, expect, test } from "vitest";

import { buildScheduledTaskMessage } from "../src/structured-task.js";

describe("buildScheduledTaskMessage", () => {
  test("formats structured task details into a future agent prompt", () => {
    expect(buildScheduledTaskMessage({
      title: "Push branch and open PR",
      objective: "Push automation/daily-sync-build and create a PR to main.",
      context: "The branch has already been verified and reviewed.",
      steps: ["git push -u origin automation/daily-sync-build", "gh pr create with the prepared title and body"],
      acceptanceCriteria: ["Remote branch exists", "PR URL is reported back in the session"],
    })).toBe(`Push branch and open PR

Objective:
Push automation/daily-sync-build and create a PR to main.

Context:
The branch has already been verified and reviewed.

Steps:
1. git push -u origin automation/daily-sync-build
2. gh pr create with the prepared title and body

Acceptance criteria:
- Remote branch exists
- PR URL is reported back in the session`);
  });

  test("falls back to the plain message when no structured fields are provided", () => {
    expect(buildScheduledTaskMessage({ message: "check the build" })).toBe("check the build");
  });
});
