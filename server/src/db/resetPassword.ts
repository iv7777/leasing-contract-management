import { db, sqlite } from "./client.js";
import { users } from "./schema.js";
import { hashPassword } from "../lib/password.js";
import { eq } from "drizzle-orm";

/** Operational CLI for resetting a user's password directly on the server.
 * There is no in-app password-change flow yet (a real gap — worth adding
 * as a proper feature), so this is the only way to change a password
 * after account creation. Run as: npm run reset-password -- <email> <new-password> */
const [, , email, newPassword] = process.argv;

if (!email || !newPassword) {
  console.error("Usage: npm run reset-password -- <email> <new-password>");
  process.exit(1);
}
if (newPassword.length < 8) {
  console.error("Password must be at least 8 characters.");
  process.exit(1);
}

const existing = db.select().from(users).where(eq(users.email, email)).get();
if (!existing) {
  console.error(`No user found with email ${email}.`);
  process.exit(1);
}

db.update(users)
  .set({ passwordHash: hashPassword(newPassword), updatedAt: new Date().toISOString() })
  .where(eq(users.email, email))
  .run();

console.log(`Password updated for ${email}.`);
sqlite.close();
