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

export type SkipReason =
  | "hidden"
  | "ignored-directory"
  | "excluded-by-pattern"
  | "not-included-by-pattern"
  | "symlink"
  | "unreadable"
  | "not-a-regular-file"
  | "directory-not-recursed";

export interface SkippedEntry {
  relativePath: string;
  reason: SkipReason;
}

export interface WalkDirectoryResult {
  files: WalkedFile[];
  skipped: SkippedEntry[];
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
export function walkDirectory(rootDir: string, options: WalkDirectoryOptions): WalkDirectoryResult {
  const results: WalkedFile[] = [];
  const skipped: SkippedEntry[] = [];
  const loopGuard = new SymlinkLoopGuard();
  let totalBytes = 0;

  function skip(relativePath: string, reason: SkipReason): void {
    skipped.push({ relativePath, reason });
  }

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

      if (isHidden(name)) {
        skip(relativePath, "hidden");
        continue;
      }

      let stats;
      try {
        stats = statSync(absolutePath);
      } catch {
        skip(relativePath, "unreadable"); // Broken symlink or race with deletion.
        continue;
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
        skip(relativePath, "symlink");
        continue;
      }

      if (stats.isDirectory()) {
        if (DEFAULT_IGNORED_DIRS.has(name)) {
          skip(relativePath, "ignored-directory");
          continue;
        }
        if (matchesAny(relativePath, options.exclude)) {
          skip(relativePath, "excluded-by-pattern");
          continue;
        }
        if (options.recursive === true) {
          visit(absolutePath);
        } else {
          skip(relativePath, "directory-not-recursed");
        }
        continue;
      }

      if (!stats.isFile()) {
        skip(relativePath, "not-a-regular-file");
        continue;
      }
      if (matchesAny(relativePath, options.exclude)) {
        skip(relativePath, "excluded-by-pattern");
        continue;
      }
      if (
        options.include &&
        options.include.length > 0 &&
        !matchesAny(relativePath, options.include)
      ) {
        skip(relativePath, "not-included-by-pattern");
        continue;
      }

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
  return { files: results, skipped };
}
