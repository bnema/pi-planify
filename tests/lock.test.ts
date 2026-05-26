import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { withLock } from "../src/lock.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pi-planify-lock-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("withLock", () => {
  test("removes stale lock directories and continues", async () => {
    const lockDir = join(dir, "stale.lock");
    await mkdir(lockDir, { recursive: true });

    const result = await withLock(lockDir, async () => "ok", { staleMs: 0, retryMs: 1 });

    expect(result).toBe("ok");
  });
});
