import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { API } from "@/lib/api";

interface LoginEvent {
  id: string;
  jobberAccountId: string;
  orgName: string | null;
  eventType: string;
  createdAt: string;
}

interface OrgRow {
  id: string;
  jobberAccountId: string;
  createdAt: string;
  trialStartedAt: string | null;
  trialEndsAt: string;
  subscriptionStatus: "trial" | "active" | "expired";
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  assetIdentifierField: string | null;
}

interface Stats {
  total: number;
  active: number;
  trial: number;
  expired: number;
  mrr: number;
}

const STATUS_STYLES: Record<string, string> = {
  active:  "bg-green-100 text-green-700",
  trial:   "bg-blue-100 text-blue-700",
  expired: "bg-red-100 text-red-700",
};

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function Admin() {
  const location = useLocation();
  const adminKey = new URLSearchParams(location.search).get("key") ?? "";

  const [stats, setStats] = useState<Stats | null>(null);
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [loginHistory, setLoginHistory] = useState<LoginEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState<string | null>(null); // orgId of in-flight action

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [dashRes, eventsRes] = await Promise.all([
        fetch(`${API}/api/admin/dashboard?key=${encodeURIComponent(adminKey)}`),
        fetch(`${API}/api/admin/login-events?key=${encodeURIComponent(adminKey)}`),
      ]);
      if (dashRes.status === 401) { setError("Invalid admin key."); return; }
      if (!dashRes.ok) { setError("Failed to load admin data."); return; }
      const data = (await dashRes.json()) as { stats: Stats; orgs: OrgRow[] };
      setStats(data.stats);
      setOrgs(data.orgs);
      if (eventsRes.ok) {
        const eventsData = (await eventsRes.json()) as { events: LoginEvent[] };
        setLoginHistory(eventsData.events);
      }
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function action(orgId: string, path: string, method = "POST") {
    setActionPending(orgId);
    try {
      const res = await fetch(`${API}/api/admin/orgs/${orgId}/${path}?key=${encodeURIComponent(adminKey)}`, { method });
      if (!res.ok) { alert("Action failed."); return; }
      await load();
    } catch {
      alert("Network error.");
    } finally {
      setActionPending(null);
    }
  }

  async function handleDelete(orgId: string, accountId: string) {
    if (!window.confirm(`Delete ALL data for org ${accountId}? This cannot be undone.`)) return;
    setActionPending(orgId);
    try {
      const res = await fetch(`${API}/api/admin/orgs/${orgId}?key=${encodeURIComponent(adminKey)}`, { method: "DELETE" });
      if (!res.ok) { alert("Delete failed."); return; }
      await load();
    } catch {
      alert("Network error.");
    } finally {
      setActionPending(null);
    }
  }

  if (loading) return (
    <div style={{ fontFamily: "Inter, sans-serif" }} className="min-h-screen bg-slate-950 flex items-center justify-center">
      <p className="text-slate-400 text-sm">Loading…</p>
    </div>
  );

  if (error) return (
    <div style={{ fontFamily: "Inter, sans-serif" }} className="min-h-screen bg-slate-950 flex items-center justify-center">
      <p className="text-red-400 text-sm">{error}</p>
    </div>
  );

  return (
    <div style={{ fontFamily: "Inter, sans-serif" }} className="min-h-screen bg-slate-950 text-slate-100">

      {/* Header */}
      <header className="border-b border-slate-800 px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold uppercase tracking-widest text-slate-500">AssetMinder</span>
          <span className="text-slate-700">/</span>
          <span className="text-sm font-semibold text-white">God Mode</span>
        </div>
        <button onClick={load} className="text-xs text-slate-500 hover:text-white transition-colors">
          Refresh
        </button>
      </header>

      <main className="max-w-7xl mx-auto px-8 py-8 space-y-8">

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            {[
              { label: "Total orgs",  value: stats.total },
              { label: "Active",      value: stats.active,  color: "text-green-400" },
              { label: "Trial",       value: stats.trial,   color: "text-blue-400" },
              { label: "Expired",     value: stats.expired, color: "text-red-400" },
              { label: "MRR",         value: `$${stats.mrr}`, color: "text-emerald-400" },
            ].map((s) => (
              <div key={s.label} className="bg-slate-900 rounded-xl border border-slate-800 px-5 py-4">
                <p className="text-xs text-slate-500 mb-1">{s.label}</p>
                <p className={`text-2xl font-bold ${s.color ?? "text-white"}`}>{s.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Org table */}
        <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-xs text-slate-500 uppercase tracking-wide">
                <th className="text-left px-5 py-3 font-medium">Org / Jobber ID</th>
                <th className="text-left px-5 py-3 font-medium">Status</th>
                <th className="text-left px-5 py-3 font-medium hidden lg:table-cell">Trial ends</th>
                <th className="text-left px-5 py-3 font-medium hidden xl:table-cell">Stripe customer</th>
                <th className="text-left px-5 py-3 font-medium hidden xl:table-cell">Stripe sub</th>
                <th className="text-left px-5 py-3 font-medium hidden md:table-cell">Joined</th>
                <th className="text-right px-5 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((org, i) => {
                const pending = actionPending === org.id;
                return (
                  <tr
                    key={org.id}
                    className={`border-b border-slate-800/50 ${i % 2 === 0 ? "" : "bg-slate-900/50"} hover:bg-slate-800/40 transition-colors`}
                  >
                    {/* Org ID */}
                    <td className="px-5 py-3">
                      <p className="font-mono text-xs text-slate-300 truncate max-w-[180px]" title={org.jobberAccountId}>
                        {org.jobberAccountId}
                      </p>
                      <p className="font-mono text-xs text-slate-600 truncate max-w-[180px]" title={org.id}>
                        {org.id}
                      </p>
                    </td>

                    {/* Status badge */}
                    <td className="px-5 py-3">
                      <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_STYLES[org.subscriptionStatus] ?? "bg-slate-700 text-slate-300"}`}>
                        {org.subscriptionStatus}
                      </span>
                    </td>

                    {/* Trial ends */}
                    <td className="px-5 py-3 text-slate-400 hidden lg:table-cell">
                      {fmt(org.trialEndsAt)}
                    </td>

                    {/* Stripe customer */}
                    <td className="px-5 py-3 hidden xl:table-cell">
                      {org.stripeCustomerId
                        ? <span className="font-mono text-xs text-slate-400 truncate max-w-[140px] block" title={org.stripeCustomerId}>{org.stripeCustomerId}</span>
                        : <span className="text-slate-700 text-xs">—</span>
                      }
                    </td>

                    {/* Stripe sub */}
                    <td className="px-5 py-3 hidden xl:table-cell">
                      {org.stripeSubscriptionId
                        ? <span className="font-mono text-xs text-slate-400 truncate max-w-[140px] block" title={org.stripeSubscriptionId}>{org.stripeSubscriptionId}</span>
                        : <span className="text-slate-700 text-xs">—</span>
                      }
                    </td>

                    {/* Joined */}
                    <td className="px-5 py-3 text-slate-400 hidden md:table-cell">
                      {fmt(org.createdAt)}
                    </td>

                    {/* Actions */}
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-2 flex-wrap">
                        <button
                          disabled={pending || org.subscriptionStatus !== "expired"}
                          title={org.subscriptionStatus !== "expired" ? "Only available for expired accounts — use Gift for trial/active" : undefined}
                          onClick={() => action(org.id, "extend-trial")}
                          className="text-xs px-2.5 py-1 rounded-md bg-blue-900/50 text-blue-300 hover:bg-blue-800/60 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          +14 days
                        </button>
                        <button
                          disabled={pending}
                          onClick={() => action(org.id, "set-active")}
                          className="text-xs px-2.5 py-1 rounded-md bg-green-900/50 text-green-300 hover:bg-green-800/60 transition-colors disabled:opacity-40"
                        >
                          Gift
                        </button>
                        <button
                          disabled={pending}
                          onClick={() => action(org.id, "set-expired")}
                          className="text-xs px-2.5 py-1 rounded-md bg-amber-900/50 text-amber-300 hover:bg-amber-800/60 transition-colors disabled:opacity-40"
                        >
                          Revoke
                        </button>
                        <button
                          disabled={pending}
                          onClick={() => handleDelete(org.id, org.jobberAccountId)}
                          className="text-xs px-2.5 py-1 rounded-md bg-red-900/50 text-red-400 hover:bg-red-800/60 transition-colors disabled:opacity-40"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {orgs.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-slate-600 text-sm">No orgs yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Login History */}
        <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-800">
            <h2 className="text-sm font-semibold text-slate-300">Login History</h2>
            <p className="text-xs text-slate-500">Last 20 OAuth authentications</p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-xs text-slate-500 uppercase tracking-wide">
                <th className="text-left px-5 py-3 font-medium">Org Name</th>
                <th className="text-left px-5 py-3 font-medium">Jobber Account ID</th>
                <th className="text-left px-5 py-3 font-medium">Event</th>
                <th className="text-left px-5 py-3 font-medium">Time</th>
              </tr>
            </thead>
            <tbody>
              {loginHistory.map((ev, i) => (
                <tr
                  key={ev.id}
                  className={`border-b border-slate-800/50 ${i % 2 === 0 ? "" : "bg-slate-900/50"}`}
                >
                  <td className="px-5 py-3 text-sm text-slate-200">{ev.orgName ?? <span className="text-slate-600">—</span>}</td>
                  <td className="px-5 py-3 font-mono text-xs text-slate-400">{ev.jobberAccountId}</td>
                  <td className="px-5 py-3">
                    <span className="inline-block text-xs font-semibold px-2 py-0.5 rounded-full bg-indigo-900/50 text-indigo-300">
                      {ev.eventType}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-slate-400 text-xs">
                    {new Date(ev.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
              {loginHistory.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-10 text-center text-slate-600 text-sm">No login events yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

      </main>
    </div>
  );
}
