import { useState } from "react";
import { API } from "@/lib/api";

interface NavProps {
  left?: React.ReactNode;
  right?: React.ReactNode;
  onSyncComplete?: () => void | Promise<void>;
}

export function Nav({ left, right, onSyncComplete }: NavProps) {
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const jobberAccountId = localStorage.getItem("jobberAccountId");

  async function handleSync() {
    if (!jobberAccountId) return;
    setSyncing(true);
    setSyncError(null);
    try {
      // Backend runs the full pipeline (sync → group → calculate) and responds
      // immediately. We wait a few seconds then reload data.
      const res = await fetch(`${API}/api/sync`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobberAccountId }) });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setSyncError(data.error ?? "Sync failed.");
        setTimeout(() => setSyncError(null), 6000);
        return;
      }
      await new Promise((r) => setTimeout(r, 15000));
      await onSyncComplete?.();
    } catch {
      setSyncError("Sync failed.");
      setTimeout(() => setSyncError(null), 4000);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <>
      <header style={{ backgroundColor: "#1e293b" }}>
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            {left}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {right}
            <button
              onClick={handleSync}
              disabled={syncing}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-white/10 text-white hover:bg-white/20 transition-colors disabled:opacity-50"
            >
              <svg className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {syncing ? "Syncing…" : "Sync Jobber"}
            </button>
          </div>
        </div>
      </header>
      {syncError && (
        <div className="bg-red-50 border-b border-red-200 px-6 py-2 text-center">
          <p className="text-xs text-red-600 font-medium">{syncError}</p>
        </div>
      )}
    </>
  );
}
