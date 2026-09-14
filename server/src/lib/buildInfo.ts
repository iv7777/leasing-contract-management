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
