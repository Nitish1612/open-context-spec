import { realpathSync } from "node:fs";
import { isAbsolute, normalize, relative, resolve, sep } from "node:path";
import { SecurityRejectionError } from "../errors.js";

/**
 * Resolves `entryName` (e.g. a zip/archive member path) against `baseDir`
 * and rejects any path that would escape `baseDir` — the "Zip Slip"
 * vulnerability class. Returns the safe absolute path.
 */
export function safeJoin(baseDir: string, entryName: string): string {
  const normalizedEntry = entryName.replace(/\\/g, "/");
  if (normalizedEntry.includes("\0")) {
    throw new SecurityRejectionError(`Rejected entry with embedded NUL byte: "${entryName}".`, {
      entryName,
    });
  }
  const target = resolve(baseDir, normalizedEntry);
  const rel = relative(baseDir, target);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new SecurityRejectionError(
      `Path traversal rejected: archive entry "${entryName}" resolves outside its base directory.`,
      { entryName, baseDir },
    );
  }
  return target;
}

/** Detects whether `path`, once symlinks are resolved, escapes `allowedRoot`. */
export function assertNoSymlinkEscape(path: string, allowedRoot: string): void {
  let real: string;
  try {
    real = realpathSync(path);
  } catch {
    return; // Path doesn't exist yet / not a symlink issue — nothing to check.
  }
  const realRoot = (() => {
    try {
      return realpathSync(allowedRoot);
    } catch {
      return normalize(allowedRoot);
    }
  })();
  const rel = relative(realRoot, real);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new SecurityRejectionError(
      `Symlink at "${path}" resolves outside the allowed root "${allowedRoot}".`,
      { path, allowedRoot, real },
    );
  }
}

/** Tracks visited real paths during a directory walk to detect symlink cycles. */
export class SymlinkLoopGuard {
  private readonly visited = new Set<string>();

  check(path: string): void {
    let real: string;
    try {
      real = realpathSync(path);
    } catch {
      return;
    }
    if (this.visited.has(real)) {
      throw new SecurityRejectionError(`Symlink loop detected at "${path}".`, { path, real });
    }
    this.visited.add(real);
  }
}

/** Normalizes a path separator-agnostically for cross-platform display/logging. */
export function toPortablePath(path: string): string {
  return path.split(sep).join("/");
}
