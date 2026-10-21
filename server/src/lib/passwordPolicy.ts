export const PASSWORD_RULE = "The password must be at least 10 characters and include both letters and numbers.";
export const PASSWORD_TOO_COMMON = "That password is too easy to guess. Choose a different one.";

const COMMON = new Set(["password123", "1234567890", "qwertyuiop", "password12", "admin12345", "changeme123", "iloveyou123", "abc1234567", "a1234567890", "passw0rd123", "welcome123", "p@ssw0rd123"]);

/** Whether a new password is acceptable; returns the English message when it is not. */
export function passwordError(password: string, email?: string): string | null {
  if (password.length < 10 || password.length > 200 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) return PASSWORD_RULE;
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return PASSWORD_TOO_COMMON;
  const local = email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) return PASSWORD_TOO_COMMON;
  return null;
}
