import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { API } from "@/lib/api";
import OrgDetailPanel from "@/components/OrgDetailPanel";

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
  displayName: string | null;
  disconnectedAt: string | null;
  createdAt: string;
  trialStartedAt: string | null;
  trialEndsAt: string;
  subscriptionStatus: "trial" | "active" | "expired";
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  assetIdentifierField: string | null;
  flags: string[];
}

interface FlagCounts {
  disconnectedTrial: number;
  tokenExpiring: number;
  abandonedCheckout: number;
  lapsingCold: number;
}

interface Stats {
  total: number;
  active: number;
  trial: number;
  expired: number;
  mrr: number;
  flags: FlagCounts;
}

const STATUS_STYLES: Record<string, string> = {
  active:  "bg-green-100 text-green-700",
  trial:   "bg-blue-100 text-blue-700",
  expired: "bg-red-100 text-red-700",
};

const HEALTH_FLAGS = [
  {
    key: "disconnectedTrial",
    label: "disconnected mid-trial",
    color: "bg-orange-900/50 text-orange-300 border-orange-700/50 hover:bg-orange-800/60",
    activeColor: "bg-orange-700/70 text-orange-200 border-orange-600 hover:bg-orange-700/80",
    dot: "bg-orange-400",
  },
  {
    key: "tokenExpiring",
    label: "token expiring <24h",
    color: "bg-yellow-900/50 text-yellow-300 border-yellow-700/50 hover:bg-yellow-800/60",
    activeColor: "bg-yellow-700/70 text-yellow-200 border-yellow-600 hover:bg-yellow-700/80",
    dot: "bg-yellow-400",
  },
  {
    key: "abandonedCheckout",
    label: "abandoned checkout",
    color: "bg-purple-900/50 text-purple-300 border-purple-700/50 hover:bg-purple-800/60",
    activeColor: "bg-purple-700/70 text-purple-200 border-purple-600 hover:bg-purple-700/80",
    dot: "bg-purple-400",
  },
  {
    key: "lapsingCold",
    label: "lapsing cold <3d",
    color: "bg-rose-900/50 text-rose-300 border-rose-700/50 hover:bg-rose-800/60",
    activeColor: "bg-rose-700/70 text-rose-200 border-rose-600 hover:bg-rose-700/80",
    dot: "bg-rose-400",
  },
] as const;

type FlagKey = typeof HEALTH_FLAGS[number]["key"];

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
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [activeFlag, setActiveFlag] = useState<FlagKey | null>(null);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [sort, setSort] = useState<{ col: "joined" | "trialEnds" | "status"; dir: "asc" | "desc" } | null>(null);

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

  function toggleFlag(key: FlagKey) {
    setActiveFlag((prev) => (prev === key ? null : key));
  }

  function toggleSort(col: "joined" | "trialEnds" | "status") {
    setSort((prev) => prev?.col === col ? { col, dir: prev.dir === "asc" ? "desc" : "asc" } : { col, dir: "asc" });
  }

  function sortIcon(col: "joined" | "trialEnds" | "status") {
    if (sort?.col !== col) return <span className="ml-1 text-slate-700">↕</span>;
    return <span className="ml-1 text-slate-400">{sort.dir === "asc" ? "↑" : "↓"}</span>;
  }

  const searchLower = search.trim().toLowerCase();

  const displayedOrgs = [...orgs]
    .filter((o) => !activeFlag || o.flags.includes(activeFlag))
    .filter((o) => !statusFilter || o.subscriptionStatus === statusFilter)
    .filter((o) => {
      if (!searchLower) return true;
      return (
        (o.displayName?.toLowerCase().includes(searchLower) ?? false) ||
        o.jobberAccountId.toLowerCase().includes(searchLower)
      );
    })
    .sort((a, b) => {
      if (!sort) return 0;
      const dir = sort.dir === "asc" ? 1 : -1;
      if (sort.col === "joined") return dir * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      if (sort.col === "trialEnds") return dir * (new Date(a.trialEndsAt).getTime() - new Date(b.trialEndsAt).getTime());
      if (sort.col === "status") return dir * a.subscriptionStatus.localeCompare(b.subscriptionStatus);
      return 0;
    });

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

  const flagCounts = stats?.flags ?? { disconnectedTrial: 0, tokenExpiring: 0, abandonedCheckout: 0, lapsingCold: 0 };
  const hasAnyFlag = Object.values(flagCounts).some((n) => n > 0);

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

      <main className="max-w-7xl mx-auto px-8 py-8 space-y-6">

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

        {/* Health flags */}
        {hasAnyFlag && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-slate-500 font-medium uppercase tracking-wide mr-1">Needs attention:</span>
            {HEALTH_FLAGS.map((flag) => {
              const count = flagCounts[flag.key];
              if (count === 0) return null;
              const isActive = activeFlag === flag.key;
              return (
                <button
                  key={flag.key}
                  onClick={() => toggleFlag(flag.key)}
                  className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border transition-colors ${isActive ? flag.activeColor : flag.color}`}
                >
                  <span className={`inline-block w-1.5 h-1.5 rounded-full ${flag.dot}`} />
                  {count} {flag.label}
                </button>
              );
            })}
            {activeFlag && (
              <button
                onClick={() => setActiveFlag(null)}
                className="text-xs text-slate-500 hover:text-slate-300 transition-colors ml-1"
              >
                Clear filter ×
              </button>
            )}
          </div>
        )}

        {/* Org table */}
        <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">

          {/* Filter bar */}
          <div className="px-5 py-3 border-b border-slate-800 flex items-center gap-3 flex-wrap">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or Jobber ID…"
              className="text-xs bg-slate-800 border border-slate-700 rounded-md px-3 py-1.5 text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-slate-500 w-56"
            />
            <div className="flex items-center gap-1">
              {(["active", "trial", "expired"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter((prev) => prev === s ? null : s)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${statusFilter === s ? STATUS_STYLES[s] + " border-transparent font-semibold" : "border-slate-700 text-slate-500 hover:text-slate-300"}`}
                >
                  {s}
                </button>
              ))}
            </div>
            {(search || statusFilter) && (
              <button onClick={() => { setSearch(""); setStatusFilter(null); }} className="text-xs text-slate-600 hover:text-slate-400 transition-colors">
                Clear ×
              </button>
            )}
            <span className="ml-auto text-xs text-slate-600">{displayedOrgs.length} org{displayedOrgs.length !== 1 ? "s" : ""}</span>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-xs text-slate-500 uppercase tracking-wide">
                <th className="text-left px-5 py-3 font-medium">Org / Jobber ID</th>
                <th className="text-left px-5 py-3 font-medium cursor-pointer select-none hover:text-slate-300" onClick={() => toggleSort("status")}>
                  Status{sortIcon("status")}
                </th>
                <th className="text-left px-5 py-3 font-medium hidden lg:table-cell cursor-pointer select-none hover:text-slate-300" onClick={() => toggleSort("trialEnds")}>
                  Trial ends{sortIcon("trialEnds")}
                </th>
                <th className="text-left px-5 py-3 font-medium hidden xl:table-cell">Stripe customer</th>
                <th className="text-left px-5 py-3 font-medium hidden xl:table-cell">Stripe sub</th>
                <th className="text-left px-5 py-3 font-medium hidden md:table-cell cursor-pointer select-none hover:text-slate-300" onClick={() => toggleSort("joined")}>
                  Joined{sortIcon("joined")}
                </th>
                <th className="text-right px-5 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayedOrgs.map((org, i) => {
                const pending = actionPending === org.id;
                return (
                  <tr
                    key={org.id}
                    onClick={() => setSelectedOrgId(org.id)}
                    className={`border-b border-slate-800/50 ${i % 2 === 0 ? "" : "bg-slate-900/50"} hover:bg-slate-800/40 transition-colors cursor-pointer`}
                  >
                    {/* Org name / ID */}
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        {org.displayName ? (
                          <p className="text-sm font-medium text-slate-200 truncate max-w-[200px]">
                            {org.displayName}
                          </p>
                        ) : (
                          <p className="text-xs text-slate-500 truncate max-w-[200px]">
                            {org.disconnectedAt ? (
                              <span className="inline-block px-1.5 py-0.5 rounded bg-slate-800 text-slate-500 mr-1">Disconnected</span>
                            ) : null}
                            …{org.jobberAccountId.slice(-12)}
                          </p>
                        )}
                        {/* Inline flag indicators */}
                        {org.flags.map((fk) => {
                          const fd = HEALTH_FLAGS.find((f) => f.key === fk);
                          if (!fd) return null;
                          return (
                            <span key={fk} className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${fd.dot}`} title={fd.label} />
                          );
                        })}
                      </div>
                      <p className="font-mono text-xs text-slate-600 truncate max-w-[200px] mt-0.5" title={org.jobberAccountId}>
                        {org.jobberAccountId}
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
                    <td className="px-5 py-3" onClick={(e) => e.stopPropagation()}>
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

              {displayedOrgs.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-slate-600 text-sm">
                    {(activeFlag || search || statusFilter) ? "No orgs match the current filters." : "No orgs yet."}
                  </td>
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

      {selectedOrgId && (
        <OrgDetailPanel
          orgId={selectedOrgId}
          adminKey={adminKey}
          onClose={() => setSelectedOrgId(null)}
          onRefreshTable={load}
        />
      )}
    </div>
  );
}
