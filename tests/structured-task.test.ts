import { describe, expect, test } from "vitest";

import { buildScheduledTaskMessage } from "../src/structured-task.js";

describe("buildScheduledTaskMessage", () => {
  test("formats structured task details into a future agent prompt", () => {
    expect(buildScheduledTaskMessage({
      title: "Publish prepared change",
      objective: "Publish the prepared branch and create the requested review item.",
      context: "The branch has already been checked and is ready for handoff.",
      steps: ["Push the prepared branch to the remote", "Create the review item with the prepared title and description"],
      acceptanceCriteria: ["Remote branch exists", "Review item URL is reported back in the session"],
    })).toBe(`Publish prepared change

Objective:
Publish the prepared branch and create the requested review item.

Context:
The branch has already been checked and is ready for handoff.

Steps:
1. Push the prepared branch to the remote
2. Create the review item with the prepared title and description

Acceptance criteria:
- Remote branch exists
- Review item URL is reported back in the session`);
  });

  test("falls back to the plain message when no structured fields are provided", () => {
    expect(buildScheduledTaskMessage({ message: "check the build" })).toBe("check the build");
  });
});
