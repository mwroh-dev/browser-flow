import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const RELEASE_PATH_MAP = new Map([
  ["surfaces/release/README.md", "README.md"],
  ["surfaces/release/HISTORY.md", "HISTORY.md"]
]);

/**
 * Map a source-repo shipping file to its path inside the public release repo.
 * Most files keep their path. Public release documents are authored under
 * `surfaces/release/` so the source README can stay development-facing.
 *
 * @param {string} rel source repo-relative path
 * @returns {string} release repo-relative path
 */
export function releasePathFor(rel) {
  return RELEASE_PATH_MAP.get(rel) ?? rel;
}

/**
 * Resolve a bundle-allowlist manifest into a sorted list of repo-relative file paths.
 *
 * When inside a git repo, only committed/tracked files are included (git ls-files).
 * When there is no .git (e.g. inside a deployed release bundle), a plain filesystem
 * walk is used instead — the allowlist include/exclude rules still apply.
 *
 * @param {string} repoRoot absolute repo root
 * @param {string} manifestPath absolute path to bundle-allowlist.json
 * @returns {string[]} repo-relative file paths (POSIX separators), sorted
 */
export function resolveShippingFiles(repoRoot, manifestPath) {
  /** @type {{ include: string[], exclude?: string[] }} */
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const exclude = manifest.exclude ?? [];
  const isExcluded = (/** @type {string} */ rel) => exclude.some((ex) => rel === ex || rel.startsWith(ex + "/"));

  // Use git ls-files when a .git dir is present (dev/build context).
  const hasGit = existsSync(resolve(repoRoot, ".git"));
  if (hasGit) {
    const stdout = execFileSync("git", ["ls-files", "-z", "--", ...manifest.include], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    const files = stdout.split("\0").filter(Boolean).filter((rel) => !isExcluded(rel));
    const out = new Set(files);
    for (const entry of manifest.include) {
      const abs = resolve(repoRoot, entry);
      if (!existsSync(abs) || isExcluded(entry)) continue;
      const st = statSync(abs);
      if (st.isDirectory()) {
        /**
         * @param {string} rel
         */
        const walk = (rel) => {
          const childAbs = resolve(repoRoot, rel);
          if (isExcluded(rel)) return;
          if (statSync(childAbs).isDirectory()) {
            for (const name of readdirSync(childAbs).sort()) {
              walk(rel ? `${rel}/${name}` : name);
            }
          } else {
            out.add(rel);
          }
        };
        walk(entry);
      } else {
        out.add(entry);
      }
    }
    return [...out].sort();
  }

  // Fallback: plain filesystem walk (bundle / no-git context).
  /** @type {string[]} */
  const out = [];
  const walk = (/** @type {string} */ rel) => {
    if (isExcluded(rel)) return;
    const abs = resolve(repoRoot, rel);
    if (!existsSync(abs)) return;
    const st = statSync(abs);
    if (st.isDirectory()) {
      for (const name of readdirSync(abs).sort()) {
        walk(rel ? `${rel}/${name}` : name);
      }
    } else {
      out.push(rel);
    }
  };
  for (const entry of manifest.include) walk(entry);
  return [...new Set(out)].sort();
}
