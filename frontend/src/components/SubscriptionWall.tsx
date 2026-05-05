import { useState } from "react";
import { API } from "@/lib/api";

export function SubscriptionWall() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const jobberAccountId = localStorage.getItem("jobberAccountId");

  async function handleSubscribe() {
    if (!jobberAccountId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/billing/create-checkout-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobberAccountId }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setError(data.error ?? "Failed to create checkout session.");
        return;
      }
      window.location.href = data.url;
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{ fontFamily: "Inter, sans-serif" }}
      className="min-h-screen bg-slate-50 flex items-center justify-center px-4"
    >
      <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8 max-w-sm w-full text-center">
        <div className="w-12 h-12 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-slate-800 mb-2">Your free trial has ended</h2>
        <p className="text-sm text-slate-500 mb-6">
          Subscribe to continue using AssetMinder. Your data is safe and your first 14 days are free.
        </p>
        {error && (
          <p className="text-xs text-red-500 mb-4">{error}</p>
        )}
        <button
          onClick={handleSubscribe}
          disabled={loading}
          className="w-full py-2.5 px-4 rounded-lg bg-slate-800 text-white text-sm font-semibold hover:bg-slate-700 transition-colors disabled:opacity-50"
        >
          {loading ? "Redirecting…" : "Start subscription — $29/month"}
        </button>
        <p className="text-xs text-slate-400 mt-3">14-day free trial · Cancel anytime</p>
      </div>
    </div>
  );
}
