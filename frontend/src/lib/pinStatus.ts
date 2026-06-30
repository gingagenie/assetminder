import { API } from "@/lib/api";

// In-memory cache of the current account's PIN status, so RequireAuth doesn't
// refetch on every protected navigation (and so it doesn't bounce back to
// /set-pin immediately after a PIN is set). Resets on full page reload.
let cache: { id: string; pinSet: boolean } | null = null;

export function getCachedPinSet(id: string): boolean | null {
  return cache && cache.id === id ? cache.pinSet : null;
}

export function setCachedPinSet(id: string, pinSet: boolean): void {
  cache = { id, pinSet };
}

export async function fetchPinSet(id: string): Promise<boolean> {
  try {
    const res = await fetch(`${API}/api/pin/status?jobberAccountId=${encodeURIComponent(id)}`);
    if (!res.ok) return true; // fail-open: a transient error shouldn't trap the user
    const data = (await res.json()) as { pinSet: boolean };
    cache = { id, pinSet: data.pinSet };
    return data.pinSet;
  } catch {
    return true; // fail-open
  }
}
