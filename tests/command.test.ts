import { describe, expect, test } from "vitest";

import { parsePlanifyCommand } from "../src/command.js";

describe("parsePlanifyCommand", () => {
  test("parses default add commands with relative time and quoted message", () => {
    expect(parsePlanifyCommand('in 15m "run the checks"')).toEqual({ action: "add", when: "in 15m", message: "run the checks" });
  });

  test("parses recurring add commands", () => {
    expect(parsePlanifyCommand('every 1h "run the checks"')).toEqual({ action: "add", every: "1h", message: "run the checks" });
    expect(parsePlanifyCommand('in 10m every 1h max 3 "run the checks"')).toEqual({ action: "add", when: "in 10m", every: "1h", maxRuns: 3, message: "run the checks" });
  });

  test("parses list and cancel commands", () => {
    expect(parsePlanifyCommand("list")).toEqual({ action: "list" });
    expect(parsePlanifyCommand("cancel task-123")).toEqual({ action: "cancel", id: "task-123" });
  });

  test("parses scheduler installation commands", () => {
    expect(parsePlanifyCommand("install-scheduler")).toEqual({ action: "install-scheduler" });
    expect(parsePlanifyCommand("install-service")).toEqual({ action: "install-service" });
  });
});
