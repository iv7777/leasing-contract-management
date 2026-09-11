import session from "express-session";
import { sqlite } from "../db/client.js";

/** Minimal SQLite-backed session store so sessions survive server restarts
 * and revoking a deactivated user's access doesn't depend on in-memory state. */
export class SqliteSessionStore extends session.Store {
  constructor() {
    super();
  }

  get(sid: string, callback: (err: unknown, session?: session.SessionData | null) => void): void {
    try {
      const row = sqlite
        .prepare("SELECT data, expires_at FROM sessions WHERE sid = ?")
        .get(sid) as { data: string; expires_at: string } | undefined;
      if (!row) return callback(null, null);
      if (new Date(row.expires_at).getTime() < Date.now()) {
        this.destroy(sid, () => {});
        return callback(null, null);
      }
      callback(null, JSON.parse(row.data));
    } catch (err) {
      callback(err);
    }
  }

  set(sid: string, sessionData: session.SessionData, callback?: (err?: unknown) => void): void {
    try {
      const maxAgeMs = sessionData.cookie?.maxAge ?? 24 * 60 * 60 * 1000;
      const expiresAt = new Date(Date.now() + maxAgeMs).toISOString();
      sqlite
        .prepare(
          `INSERT INTO sessions (sid, data, expires_at) VALUES (?, ?, ?)
           ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at`,
        )
        .run(sid, JSON.stringify(sessionData), expiresAt);
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }

  destroy(sid: string, callback?: (err?: unknown) => void): void {
    try {
      sqlite.prepare("DELETE FROM sessions WHERE sid = ?").run(sid);
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }

  touch(sid: string, sessionData: session.SessionData, callback?: () => void): void {
    this.set(sid, sessionData, callback);
  }
}
