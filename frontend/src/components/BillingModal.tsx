import { useEffect, useState } from "react";
import { API } from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface BillingStatus {
  subscriptionStatus: "trial" | "active" | "expired";
  trialDaysLeft: number;
  trialExpired: boolean;
  trialEndsAt: string;
  nextBillingDate: string | null;
}

interface BillingModalProps {
  open: boolean;
  onClose: () => void;
}

export function BillingModal({ open, onClose }: BillingModalProps) {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    fetch(`${API}/api/billing/status`)
      .then((r) => r.json())
      .then((data: BillingStatus) => setStatus(data))
      .catch(() => setError("Failed to load billing status."))
      .finally(() => setLoading(false));
  }, [open]);

  async function handleSubscribe() {
    setActionLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/billing/create-checkout-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setError(data.error ?? "Failed to start checkout.");
        return;
      }
      window.location.href = data.url;
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setActionLoading(false);
    }
  }

  async function handlePortal() {
    setActionLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/billing/portal-url`);
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setError(data.error ?? "Failed to open billing portal.");
        return;
      }
      window.open(data.url, "_blank", "noopener,noreferrer");
      onClose();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setActionLoading(false);
    }
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent style={{ fontFamily: "Inter, sans-serif" }}>
        <DialogHeader>
          <DialogTitle className="text-slate-800">Billing</DialogTitle>
        </DialogHeader>

        {loading && <p className="text-sm text-slate-400 py-4 text-center">Loading…</p>}

        {!loading && error && <p className="text-sm text-red-500">{error}</p>}

        {!loading && status && (
          <div className="space-y-4">
            {status.subscriptionStatus === "trial" && (
              <>
                <div className="rounded-lg bg-blue-50 border border-blue-100 px-4 py-3">
                  <p className="text-sm font-semibold text-blue-800">You're on a free trial</p>
                  <p className="text-sm text-blue-600 mt-0.5">
                    Your trial ends on <span className="font-medium">{formatDate(status.trialEndsAt)}</span>
                  </p>
                </div>
                {error && <p className="text-xs text-red-500">{error}</p>}
                <button
                  onClick={handleSubscribe}
                  disabled={actionLoading}
                  className="w-full py-2.5 px-4 rounded-lg bg-slate-800 text-white text-sm font-semibold hover:bg-slate-700 transition-colors disabled:opacity-50"
                >
                  {actionLoading ? "Redirecting…" : "Subscribe now — $29/month"}
                </button>
                <p className="text-xs text-slate-400 text-center">14-day free trial included · Cancel anytime</p>
              </>
            )}

            {status.subscriptionStatus === "active" && (
              <>
                <div className="rounded-lg bg-green-50 border border-green-100 px-4 py-3">
                  <p className="text-sm font-semibold text-green-800">Your subscription is active</p>
                  {status.nextBillingDate && (
                    <p className="text-sm text-green-600 mt-0.5">
                      Next billing date: <span className="font-medium">{formatDate(status.nextBillingDate)}</span>
                    </p>
                  )}
                </div>
                {error && <p className="text-xs text-red-500">{error}</p>}
                <button
                  onClick={handlePortal}
                  disabled={actionLoading}
                  className="w-full py-2.5 px-4 rounded-lg bg-slate-800 text-white text-sm font-semibold hover:bg-slate-700 transition-colors disabled:opacity-50"
                >
                  {actionLoading ? "Opening…" : "Manage subscription"}
                </button>
              </>
            )}

            {status.subscriptionStatus === "expired" && (
              <>
                <div className="rounded-lg bg-amber-50 border border-amber-100 px-4 py-3">
                  <p className="text-sm font-semibold text-amber-800">Your trial has ended</p>
                  <p className="text-sm text-amber-600 mt-0.5">Subscribe to continue using AssetMinder.</p>
                </div>
                {error && <p className="text-xs text-red-500">{error}</p>}
                <button
                  onClick={handleSubscribe}
                  disabled={actionLoading}
                  className="w-full py-2.5 px-4 rounded-lg bg-slate-800 text-white text-sm font-semibold hover:bg-slate-700 transition-colors disabled:opacity-50"
                >
                  {actionLoading ? "Redirecting…" : "Subscribe now — $29/month"}
                </button>
                <p className="text-xs text-slate-400 text-center">14-day free trial included · Cancel anytime</p>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
