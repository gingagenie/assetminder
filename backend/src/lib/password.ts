import argon2 from "argon2";

/** A password must be 8–200 characters. */
export function isValidPassword(pw: unknown): pw is string {
  return typeof pw === "string" && pw.length >= 8 && pw.length <= 200;
}

/** Hash a password with argon2id. */
export function hashPassword(pw: string): Promise<string> {
  return argon2.hash(pw, { type: argon2.argon2id });
}

/** Verify a password against a stored argon2 hash. Never throws. */
export async function verifyPassword(stored: string | null, pw: string): Promise<boolean> {
  if (!stored) return false;
  try {
    return await argon2.verify(stored, pw);
  } catch {
    return false;
  }
}
