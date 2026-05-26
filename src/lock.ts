import { mkdir, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

export interface LockOptions {
  staleMs?: number;
  retryMs?: number;
}

const DEFAULT_STALE_MS = 15 * 60_000;
const DEFAULT_RETRY_MS = 25;

export async function withLock<T>(lockDir: string, run: () => Promise<T>, options: LockOptions = {}): Promise<T> {
  await mkdir(dirname(lockDir), { recursive: true });
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const retryMs = options.retryMs ?? DEFAULT_RETRY_MS;

  for (;;) {
    try {
      await mkdir(lockDir);
      break;
    } catch (error) {
      if (!isErrorCode(error, "EEXIST")) throw error;
      if (await removeIfStale(lockDir, staleMs)) continue;
      await sleep(retryMs);
    }
  }

  try {
    return await run();
  } finally {
    await rm(lockDir, { recursive: true, force: true });
  }
}

async function removeIfStale(lockDir: string, staleMs: number): Promise<boolean> {
  if (staleMs < 0) return false;
  try {
    const stats = await stat(lockDir);
    if (Date.now() - stats.mtimeMs < staleMs) return false;
    await rm(lockDir, { recursive: true, force: true });
    return true;
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) return true;
    throw error;
  }
}

function isErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
