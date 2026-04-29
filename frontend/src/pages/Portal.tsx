import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { API } from "@/lib/api";

interface PortalAsset {
  id: string;
  identifier: string;
  displayName: string;
  lastServicedAt: string | null;
  nextDueAt: string | null;
  jobCount: number;
  status: "ok" | "amber" | "overdue" | "unscheduled";
}

interface PortalData {
  client: { name: string; email: string | null };
  assets: PortalAsset[];
}

interface JobEntry {
  id: string;
  jobNumber: number | null;
  title: string | null;
  completedAt: string | null;
  jobStatus: string;
}

const statusConfig = {
  ok: { label: "OK", pill: "bg-green-100 text-green-700", border: "border-l-green-500" },
  amber: { label: "Due Soon", pill: "bg-amber-100 text-amber-700", border: "border-l-amber-500" },
  overdue: { label: "Overdue", pill: "bg-red-100 text-red-700", border: "border-l-red-500" },
  unscheduled: { label: "Unscheduled", pill: "bg-slate-100 text-slate-500", border: "border-l-slate-300" },
};

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
}

function buildSummary(assets: PortalAsset[]) {
  const total = assets.length;
  const overdue = assets.filter((a) => a.status === "overdue").length;
  const due = assets.filter((a) => a.status === "amber").length;
  const parts: string[] = [`${total} asset${total !== 1 ? "s" : ""} tracked`];
  if (overdue > 0) parts.push(`${overdue} overdue`);
  else if (due > 0) parts.push(`${due} service${due !== 1 ? "s" : ""} due soon`);
  else if (total > 0) parts.push("all services up to date");
  return parts.join(" · ");
}

export default function Portal() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [search, setSearch] = useState("");

  // Expanded asset state + lazy-loaded jobs
  const [expandedAssets, setExpandedAssets] = useState<Set<string>>(new Set());
  const [assetJobs, setAssetJobs] = useState<Record<string, JobEntry[]>>({});
  const [loadingJobs, setLoadingJobs] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch(`${API}/api/portal/${token}`)
      .then((r) => {
        if (r.status === 404) { setNotFound(true); return null; }
        return r.json();
      })
      .then((d) => { if (d) setData(d as PortalData); })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [token]);

  async function toggleAsset(assetId: string) {
    setExpandedAssets((prev) => {
      const next = new Set(prev);
      if (next.has(assetId)) {
        next.delete(assetId);
        return next;
      }
      next.add(assetId);
      return next;
    });

    // Fetch jobs if not already loaded
    if (!assetJobs[assetId]) {
      setLoadingJobs((prev) => new Set(prev).add(assetId));
      try {
        const res = await fetch(`${API}/api/assets/${assetId}/jobs`);
        const d = await res.json() as { jobs: JobEntry[] };
        setAssetJobs((prev) => ({ ...prev, [assetId]: d.jobs }));
      } catch {
        setAssetJobs((prev) => ({ ...prev, [assetId]: [] }));
      } finally {
        setLoadingJobs((prev) => { const n = new Set(prev); n.delete(assetId); return n; });
      }
    }
  }

  if (loading) {
    return (
      <div style={{ fontFamily: "Inter, sans-serif" }} className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-slate-400 text-sm">Loading…</p>
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div style={{ fontFamily: "Inter, sans-serif" }} className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center space-y-2">
          <p className="text-slate-800 font-semibold text-xl">Portal not found</p>
          <p className="text-slate-400 text-sm">This link may have expired or is invalid.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "Inter, sans-serif", backgroundColor: "#f8fafc" }} className="min-h-screen">

      {/* Nav */}
      <header style={{ backgroundColor: "#1e293b" }}>
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <span className="text-white font-semibold text-lg tracking-tight">AssetMinder</span>
          <span className="text-slate-400 text-sm font-medium">{data.client.name}</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10 space-y-8">

        {/* Hero */}
        <div className="space-y-1">
          <p className="text-slate-400 text-xs font-semibold uppercase tracking-widest">Asset Service Record</p>
          <h1 className="text-3xl font-bold text-slate-800 tracking-tight">{data.client.name}</h1>
          <p className="text-slate-500 text-sm">{buildSummary(data.assets)}</p>
        </div>

        {/* Asset cards */}
        <div className="space-y-3">
          {data.assets.length > 1 && (
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by asset name or serial number..."
              className="w-full px-4 py-2.5 rounded-lg border border-slate-200 bg-white text-sm text-slate-800 placeholder-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
            />
          )}
          {data.assets.length === 0 ? (
            <p className="text-slate-400 text-sm">No assets on record.</p>
          ) : (() => {
            const query = search.trim().toLowerCase();
            const filtered = query
              ? data.assets.filter(
                  (a) =>
                    a.displayName.toLowerCase().includes(query) ||
                    a.identifier.toLowerCase().includes(query)
                )
              : data.assets;

            if (filtered.length === 0) {
              return <p className="text-slate-400 text-sm">No assets found.</p>;
            }

            return filtered.map((asset) => {
              const { label, pill, border } = statusConfig[asset.status];
              const isExpanded = expandedAssets.has(asset.id);
              const jobs = assetJobs[asset.id] ?? [];
              const isLoadingJobs = loadingJobs.has(asset.id);

              return (
                <div
                  key={asset.id}
                  className={`bg-white rounded-xl shadow-sm border border-slate-200 border-l-4 ${border} overflow-hidden`}
                >
                  {/* Asset summary — click to expand */}
                  <button
                    onClick={() => toggleAsset(asset.id)}
                    className="w-full text-left px-6 py-5 hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4 mb-4">
                      <div>
                        <p className="font-bold text-slate-800 text-base">{asset.displayName}</p>
                        <p className="text-slate-400 text-xs mt-0.5">{asset.identifier}</p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${pill}`}>
                          {label}
                        </span>
                        <svg
                          className={`h-4 w-4 text-slate-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <p className="text-slate-400 text-xs mb-0.5">Last serviced</p>
                        <p className="text-slate-700 text-sm font-medium">{formatDate(asset.lastServicedAt)}</p>
                      </div>
                      <div>
                        <p className="text-slate-400 text-xs mb-0.5">Next due</p>
                        <p className="text-slate-700 text-sm font-medium">{formatDate(asset.nextDueAt)}</p>
                      </div>
                      <div>
                        <p className="text-slate-400 text-xs mb-0.5">Service records</p>
                        <p className="text-slate-700 text-sm font-medium">{asset.jobCount}</p>
                      </div>
                    </div>
                  </button>

                  {/* Expanded job list */}
                  {isExpanded && (
                    <div className="border-t border-slate-100">
                      {isLoadingJobs ? (
                        <p className="px-6 py-4 text-sm text-slate-400">Loading service records…</p>
                      ) : jobs.length === 0 ? (
                        <p className="px-6 py-4 text-sm text-slate-400">No service records found.</p>
                      ) : (
                        <div className="divide-y divide-slate-100">
                          {jobs.map((job) => (
                            <div key={job.id} className="px-6 py-4 flex items-center justify-between gap-4">
                              <div>
                                <p className="font-semibold text-slate-800 text-sm">
                                  {job.title ?? `Job #${job.jobNumber ?? "—"}`}
                                  {job.jobNumber && job.title && (
                                    <span className="ml-2 text-xs text-slate-400 font-normal">#{job.jobNumber}</span>
                                  )}
                                </p>
                                <p className="text-xs text-slate-400 mt-0.5 capitalize">
                                  {job.jobStatus.toLowerCase().replace(/_/g, " ")}
                                </p>
                              </div>
                              <div className="flex items-center gap-3 shrink-0">
                                <p className="text-sm text-slate-400">{formatDate(job.completedAt)}</p>
                                <button
                                  onClick={() => window.open(`${API}/api/jobs/${job.id}/pdf`, '_blank')}
                                  className="text-xs font-semibold px-2.5 py-1 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 hover:border-slate-300 transition-colors"
                                >
                                  PDF
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            });
          })()}
        </div>

        {/* Footer */}
        <div className="pt-4 border-t border-slate-200 text-center">
          <p className="text-slate-400 text-xs">Powered by AssetMinder</p>
        </div>

      </main>
    </div>
  );
}
