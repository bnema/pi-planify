import { describe, expect, test } from "vitest";

import { parsePlanifyCommand } from "../src/command.js";

describe("parsePlanifyCommand", () => {
  test("parses default add commands with relative time and quoted message", () => {
    expect(parsePlanifyCommand('in 15m "run the checks"')).toEqual({ action: "add", when: "in 15m", message: "run the checks" });
  });

  test("parses list and cancel commands", () => {
    expect(parsePlanifyCommand("list")).toEqual({ action: "list" });
    expect(parsePlanifyCommand("cancel task-123")).toEqual({ action: "cancel", id: "task-123" });
  });
});
