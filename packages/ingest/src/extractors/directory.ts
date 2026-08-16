import { lstatSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { minimatch } from "minimatch";
import { SecurityRejectionError } from "../errors.js";
import { assertWithinByteLimit, assertWithinCount } from "../security/limits.js";
import { SymlinkLoopGuard } from "../security/paths.js";
import type { ResourceLimits } from "../types.js";

const DEFAULT_IGNORED_DIRS = new Set([".git", "node_modules", "dist", "build", "coverage"]);

export interface WalkDirectoryOptions {
  recursive?: boolean;
  include?: string[];
  exclude?: string[];
  limits: ResourceLimits;
}

export interface WalkedFile {
  absolutePath: string;
  relativePath: string;
  size: number;
}

function isHidden(name: string): boolean {
  return name.startsWith(".");
}

function matchesAny(path: string, patterns: string[] | undefined): boolean {
  if (!patterns || patterns.length === 0) return false;
  return patterns.some((pattern) => minimatch(path, pattern, { dot: true, matchBase: true }));
}

/**
 * Walks `rootDir` deterministically (entries sorted lexically at every
 * level), skipping hidden files/dirs and common generated directories by
 * default, never following symlinks (unless `followSymlinks` is enabled by
 * the caller), and enforcing directory-wide file-count/byte-size limits.
 */
export function walkDirectory(rootDir: string, options: WalkDirectoryOptions): WalkedFile[] {
  const results: WalkedFile[] = [];
  const loopGuard = new SymlinkLoopGuard();
  let totalBytes = 0;

  function visit(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir).sort((a, b) => a.localeCompare(b));
    } catch (error) {
      throw new SecurityRejectionError(
        `Failed to read directory "${dir}": ${error instanceof Error ? error.message : String(error)}`,
        { dir },
      );
    }

    for (const name of entries) {
      const absolutePath = join(dir, name);
      const relativePath = relative(rootDir, absolutePath).split("\\").join("/");

      if (isHidden(name)) continue;

      let stats;
      try {
        stats = statSync(absolutePath);
      } catch {
        continue; // Broken symlink or race with deletion — skip.
      }

      let lstatIsSymlink = false;
      try {
        lstatIsSymlink = lstatSync(absolutePath).isSymbolicLink();
      } catch {
        lstatIsSymlink = false;
      }
      if (lstatIsSymlink) {
        // Symlinks are never followed by default; detect loops defensively
        // in case a future caller opts in.
        loopGuard.check(absolutePath);
        continue;
      }

      if (stats.isDirectory()) {
        if (DEFAULT_IGNORED_DIRS.has(name)) continue;
        if (matchesAny(relativePath, options.exclude)) continue;
        if (options.recursive === true) visit(absolutePath);
        continue;
      }

      if (!stats.isFile()) continue;
      if (matchesAny(relativePath, options.exclude)) continue;
      if (
        options.include &&
        options.include.length > 0 &&
        !matchesAny(relativePath, options.include)
      )
        continue;

      totalBytes += stats.size;
      assertWithinByteLimit(
        totalBytes,
        options.limits.maxDirectoryTotalBytes,
        "Directory total size",
      );
      assertWithinCount(
        results.length + 1,
        options.limits.maxDirectoryFileCount,
        "Directory file count",
      );

      results.push({ absolutePath, relativePath, size: stats.size });
    }
  }

  visit(rootDir);
  return results;
}
