import { execSync } from "node:child_process";
import path from "node:path";

export const APP_VERSION = "1.01";

const SERVER_START_TIME = new Date().toISOString();

/** "Build date" is really "when was the code currently running here last
 * changed" — the most accurate, zero-config answer to that is the commit
 * date of HEAD in the deployed checkout, so we shell out to git once at
 * startup rather than requiring a separate build step or env var. Falls
 * back to BUILD_DATE (for a non-git deployment) and finally to process
 * start time if neither is available, so this never throws. */
function computeBuildDate(): string {
  try {
    const repoRoot = path.resolve(process.cwd(), "..");
    const commitDate = execSync("git log -1 --format=%cI", { cwd: repoRoot, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    if (commitDate) return commitDate;
  } catch {
    // not a git checkout, git not installed, etc. — fall through
  }
  if (process.env.BUILD_DATE) return process.env.BUILD_DATE;
  return SERVER_START_TIME;
}

export const BUILD_DATE = computeBuildDate();

/** The build number is simply "how many commits are in this checkout's
 * history" (git rev-list --count HEAD) — every commit is one more entry in
 * that count, so it increases automatically with no extra mechanism, no
 * stored counter to keep in sync, and no separate commit needed to bump it.
 * Falls back to the BUILD_NUMBER env var, then null (surfaced to the UI as
 * "unknown"), so a non-git deployment or a shallow clone (which reports only
 * the commits it fetched) never throws — just deploy from a full clone, as
 * vps-deploy.sh already does, for an accurate count. */
function computeBuildNumber(): number | null {
  try {
    const repoRoot = path.resolve(process.cwd(), "..");
    const count = execSync("git rev-list --count HEAD", { cwd: repoRoot, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    if (count) return Number(count);
  } catch {
    // not a git checkout, git not installed, etc. — fall through
  }
  if (process.env.BUILD_NUMBER) return Number(process.env.BUILD_NUMBER);
  return null;
}

export const BUILD_NUMBER = computeBuildNumber();
