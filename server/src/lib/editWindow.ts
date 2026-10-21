/** How long the person who recorded an entry (and any Admin) can still correct
 * it directly. After that the entry is locked and a correction has to be a
 * reversal or a void, with a reason. */
export const EDIT_WINDOW_HOURS = 24;

const WINDOW_MS = EDIT_WINDOW_HOURS * 60 * 60 * 1000;

/** When the correction window of an entry saved at `createdAtIso` closes. */
export function editWindowEnd(createdAtIso: string): string {
  return new Date(new Date(createdAtIso).getTime() + WINDOW_MS).toISOString();
}

export function withinEditWindow(createdAtIso: string, now: number = Date.now()): boolean {
  const created = new Date(createdAtIso).getTime();
  return Number.isFinite(created) && now - created < WINDOW_MS;
}

export const EDIT_WINDOW_CLOSED = "The time for correcting this entry has passed. An Admin can reverse it instead.";
export const EDIT_NOT_YOURS = "Only the person who recorded this entry, or an Admin, can edit it.";

/** Whether `user` may edit an entry that `createdBy` saved at `createdAtIso`. */
export function canEditEntry(user: { id: number; role: string }, createdBy: number, createdAtIso: string, now: number = Date.now()): boolean {
  return (user.role === "admin" || user.id === createdBy) && withinEditWindow(createdAtIso, now);
}
