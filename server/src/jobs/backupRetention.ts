// Pure retention/scheduling rules for backups, kept free of filesystem and
// database imports so they can be unit-tested directly (backup.test.ts).
// The db/fs wiring that actually applies these lives in backup.ts.

export type BackupKind = "daily" | "weekly";

// Keep the most recent 30 of each kind, prune the rest. The two kinds are
// counted and pruned independently, so a full weekly rotation doesn't crowd
// out daily copies or vice versa.
export const DAILY_RETENTION_LIMIT = 30;
export const WEEKLY_RETENTION_LIMIT = 30;

/** Given a kind's successful run ids oldest-first, returns the ones beyond
 * the retention limit that should be pruned (also oldest-first). */
export function selectRunsToPrune(idsOldestFirst: number[], retentionLimit: number): number[] {
  const excess = idsOldestFirst.length - retentionLimit;
  return excess > 0 ? idsOldestFirst.slice(0, excess) : [];
}

/** A weekly backup only starts once the daily rotation is full — until then
 * a weekly copy would preserve nothing a same-age daily copy doesn't
 * already cover for at least as long. The caller is expected to already be
 * running this only on Sundays (the cron schedule in index.ts); this just
 * gates on retention depth. */
export function isWeeklyBackupDue(dailyRunCount: number, dailyRetentionLimit: number = DAILY_RETENTION_LIMIT): boolean {
  return dailyRunCount >= dailyRetentionLimit;
}
