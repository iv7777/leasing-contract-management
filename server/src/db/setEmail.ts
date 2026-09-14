import { db, sqlite } from "./client.js";
import { users } from "./schema.js";
import { eq } from "drizzle-orm";

/** Operational CLI for renaming a user's login email directly on the server.
 * Used by the VPS deploy script to keep the seeded admin's email in sync
 * with a changed ADMIN_EMAIL, since the script has no session to call the
 * in-app Edit User feature with. Run as: npm run set-email -- <old-email> <new-email> */
const [, , oldEmail, newEmail] = process.argv;

if (!oldEmail || !newEmail) {
  console.error("Usage: npm run set-email -- <old-email> <new-email>");
  process.exit(1);
}

const existing = db.select().from(users).where(eq(users.email, oldEmail)).get();
if (!existing) {
  console.log(`No user found with email ${oldEmail} — nothing to update.`);
  sqlite.close();
  process.exit(0);
}

const taken = db.select().from(users).where(eq(users.email, newEmail)).get();
if (taken && taken.id !== existing.id) {
  console.error(`Another user already uses ${newEmail} — not updating.`);
  process.exit(1);
}

db.update(users)
  .set({ email: newEmail, updatedAt: new Date().toISOString() })
  .where(eq(users.id, existing.id))
  .run();

console.log(`Updated login email: ${oldEmail} -> ${newEmail}.`);
sqlite.close();
