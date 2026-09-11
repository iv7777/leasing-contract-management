import { db, sqlite } from "./client.js";
import { users } from "./schema.js";
import { hashPassword } from "../lib/password.js";
import { eq } from "drizzle-orm";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";

const existing = db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).get();

if (existing) {
  console.log(`Admin user ${ADMIN_EMAIL} already exists, skipping seed.`);
} else {
  db.insert(users)
    .values({
      name: "Administrator",
      email: ADMIN_EMAIL,
      passwordHash: hashPassword(ADMIN_PASSWORD),
      role: "admin",
      active: true,
      canDownloadPdf: true,
      canPrint: true,
      preferredLocale: "en",
    })
    .run();
  console.log(`Seeded admin user: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  console.log("Change this password immediately after first login.");
}

sqlite.close();
