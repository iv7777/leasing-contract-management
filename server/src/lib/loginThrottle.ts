/** Slows down password guessing: too many failed logins for the same address
 * from the same place (or for the same address from anywhere, at a higher
 * bar) lock further attempts for a while. In memory on purpose — a restart
 * clears it, and it never touches a legitimate user's account. */
export class LoginThrottle {
  private fails = new Map<string, number[]>();

  constructor(
    private readonly windowMs = 15 * 60 * 1000,
    private readonly perSource = 8,
    private readonly perAccount = 30,
  ) {}

  private recent(key: string, now: number): number[] {
    const list = (this.fails.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length) this.fails.set(key, list);
    else this.fails.delete(key);
    return list;
  }

  /** Milliseconds until another attempt is allowed, or 0. */
  retryAfterMs(source: string, email: string, now = Date.now()): number {
    const mail = email.trim().toLowerCase();
    const wait = (list: number[], limit: number) => (list.length >= limit ? this.windowMs - (now - list[list.length - limit]) : 0);
    return Math.max(wait(this.recent(`s:${source}|${mail}`, now), this.perSource), wait(this.recent(`a:${mail}`, now), this.perAccount));
  }

  recordFailure(source: string, email: string, now = Date.now()): void {
    const mail = email.trim().toLowerCase();
    for (const key of [`s:${source}|${mail}`, `a:${mail}`]) this.fails.set(key, [...this.recent(key, now), now]);
  }

  recordSuccess(source: string, email: string): void {
    this.fails.delete(`s:${source}|${email.trim().toLowerCase()}`);
  }
}

export const loginThrottle = new LoginThrottle();
