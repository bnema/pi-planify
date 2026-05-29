import { isAbsolute } from "node:path";

export type IsAbsolutePathFn = (path: string) => boolean;

export function requireAbsolutePath(path: string, message: string, isAbsolutePath: IsAbsolutePathFn = isAbsolute): string {
  if (!isAbsolutePath(path)) throw new Error(`${message}, got: ${path}`);
  return path;
}
