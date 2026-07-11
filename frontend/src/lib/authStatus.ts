import { API } from "./api";

export interface AuthState {
  authenticated: boolean;
  jobberAccountId?: string;
  email?: string;
  name?: string;
  passwordSet?: boolean;
  subscriptionStatus?: string;
}

// In-memory cache so route changes don't blank the screen while re-checking.
let cached: AuthState | null = null;

export function getCachedAuth(): AuthState | null {
  return cached;
}

export function setCachedAuth(state: AuthState): void {
  cached = state;
}

export function clearCachedAuth(): void {
  cached = null;
}

export async function fetchAuth(): Promise<AuthState> {
  try {
    const res = await fetch(`${API}/auth/session`);
    const state = (await res.json()) as AuthState;
    cached = state;
    return state;
  } catch {
    const anon: AuthState = { authenticated: false };
    cached = anon;
    return anon;
  }
}
