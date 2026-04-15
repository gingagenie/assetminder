import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, useLocation, Link } from "react-router-dom";
import { API } from "@/lib/api";
import { ChevronLeft } from "lucide-react";

// ---------- Types ----------

interface AssetDetail {
  id: string;
  identifier: string;
  displayName: string;
  clientName: string | null;
  jobberClientId: string | null;
  lastServicedAt: string | null;
  nextDueAt: string | null;
  serviceIntervalDays: number | null;
  jobCount: number;
  status: "ok" | "amber" | "overdue" | "unscheduled";
}

interface LineItem {
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

interface JobEntry {
  id: string;
  jobNumber: number | null;
  title: string | null;
  completedAt: string | null;
  jobStatus: string;
  customFields: { label: string; value: string | null }[];
  lineItems: LineItem[];
  technicianName: string | null;
  instructions: string | null;
}

// ---------- Helpers ----------

const statusConfig = {
  ok: { label: "OK", pill: "bg-green-100 text-green-700" },
  amber: { label: "Due Soon", pill: "bg-amber-100 text-amber-700" },
  overdue: { label: "Overdue", pill: "bg-red-100 text-red-700" },
  unscheduled: { label: "Unscheduled", pill: "bg-slate-100 text-slate-500" },
};

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
}

// ---------- Component ----------

export default function AssetDetail() {
  const { assetId } = useParams<{ assetId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const fromClient = (location.state as { clientId: string; clientName: string } | null) ?? null;
  const jobberAccountId = localStorage.getItem("jobberAccountId");

  const [asset, setAsset] = useState<AssetDetail | null>(null);
  const [jobsList, setJobsList] = useState<JobEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [intervalInput, setIntervalInput] = useState<string>("");
  const [savingInterval, setSavingInterval] = useState(false);
  const [intervalSaved, setIntervalSaved] = useState(false);
  const [intervalError, setIntervalError] = useState<string | null>(null);
  const [expandedJobs, setExpandedJobs] = useState<Set<string>>(new Set());
  const [jobNotes, setJobNotes] = useState<Record<string, { workNotes: string | null; technicianName: string | null }>>({});
  const [loadingNotes, setLoadingNotes] = useState<Set<string>>(new Set());

  async function toggleJob(id: string) {
    setExpandedJobs((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

    // Lazy-load visit notes on first expand
    if (!jobNotes[id]) {
      setLoadingNotes((prev) => new Set(prev).add(id));
      try {
        const res = await fetch(`${API}/api/jobs/${id}/notes`);
        const data = await res.json() as { workNotes: string | null; technicianName: string | null };
        setJobNotes((prev) => ({ ...prev, [id]: data }));
      } catch {
        setJobNotes((prev) => ({ ...prev, [id]: { workNotes: null, technicianName: null } }));
      } finally {
        setLoadingNotes((prev) => { const n = new Set(prev); n.delete(id); return n; });
      }
    }
  }

  const ran = useRef(false);

  useEffect(() => {
    if (!jobberAccountId) { navigate("/"); return; }
    if (ran.current) return;
    ran.current = true;

    fetch(`${API}/api/assets/${assetId}/jobs`)
      .then((r) => r.json())
      .then((data: { asset: AssetDetail; jobs: JobEntry[] }) => {
        setAsset(data.asset);
        setJobsList(data.jobs);
        setIntervalInput(String(data.asset.serviceIntervalDays ?? ""));
      })
      .catch(() => setError("Failed to load asset."))
      .finally(() => setLoading(false));
  }, [assetId, jobberAccountId, navigate]);

  async function handleSaveInterval() {
    if (!asset || !jobberAccountId) return;
    const days = parseInt(intervalInput, 10);
    if (!days || days < 1) { setIntervalError("Enter a valid number of days."); return; }

    setSavingInterval(true);
    setIntervalError(null);
    setIntervalSaved(false);

    try {
      await fetch(`${API}/api/assets/${asset.id}/interval`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intervalDays: days, jobberAccountId }),
      });

      await fetch(`${API}/api/calculate-due-dates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobberAccountId }),
      });

      const res = await fetch(`${API}/api/assets/${asset.id}/jobs`);
      const data = (await res.json()) as { asset: AssetDetail; jobs: JobEntry[] };
      setAsset(data.asset);
      setJobsList(data.jobs);
      setIntervalSaved(true);
      setTimeout(() => setIntervalSaved(false), 2500);
    } catch {
      setIntervalError("Failed to save interval. Please try again.");
    } finally {
      setSavingInterval(false);
    }
  }

  if (loading) {
    return (
      <div style={{ fontFamily: "Inter, sans-serif" }} className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-slate-400 text-sm">Loading…</p>
      </div>
    );
  }

  if (error || !asset) {
    return (
      <div style={{ fontFamily: "Inter, sans-serif" }} className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-red-500 text-sm">{error ?? "Asset not found."}</p>
      </div>
    );
  }

  const { label, pill } = statusConfig[asset.status];

  return (
    <div style={{ fontFamily: "Inter, sans-serif", backgroundColor: "#f8fafc" }} className="min-h-screen">

      {/* Nav */}
      <header style={{ backgroundColor: "#1e293b" }}>
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <span className="text-white font-semibold text-lg tracking-tight">AssetMinder</span>
          {asset.clientName && (
            <span className="text-slate-400 text-sm font-medium">{asset.clientName}</span>
          )}
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10 space-y-8">

        {/* Back link */}
        <Link
          to={fromClient ? `/clients/${fromClient.clientId}` : "/dashboard"}
          className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-600 transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          {fromClient ? `Back to ${fromClient.clientName}` : "Back to dashboard"}
        </Link>

        {/* Hero */}
        <div className="space-y-4">
          {asset.clientName && (
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">{asset.clientName}</p>
          )}
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl font-bold text-slate-800 tracking-tight">{asset.displayName}</h1>
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${pill}`}>
              {label}
            </span>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-4 pt-1">
            <div>
              <p className="text-slate-400 text-xs mb-0.5">Last serviced</p>
              <p className="text-slate-700 text-sm font-semibold">{formatDate(asset.lastServicedAt)}</p>
            </div>
            <div>
              <p className="text-slate-400 text-xs mb-0.5">Next due</p>
              <p className="text-slate-700 text-sm font-semibold">{formatDate(asset.nextDueAt)}</p>
            </div>
            <div>
              <p className="text-slate-400 text-xs mb-0.5">Service records</p>
              <p className="text-slate-700 text-sm font-semibold">{asset.jobCount}</p>
            </div>
          </div>
        </div>

        {/* Service interval card */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 px-6 py-5">
          <p className="text-sm font-semibold text-slate-700 mb-4">Service interval</p>
          <div className="flex items-center gap-3">
            <input
              type="number"
              min={1}
              value={intervalInput}
              onChange={(e) => setIntervalInput(e.target.value)}
              placeholder="e.g. 90"
              className="h-10 w-28 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-300"
            />
            <span className="text-sm text-slate-400">days</span>
            <button
              onClick={handleSaveInterval}
              disabled={savingInterval}
              style={{ backgroundColor: savingInterval ? undefined : "#1e293b" }}
              className="h-10 px-4 rounded-lg text-sm font-semibold text-white bg-slate-700 hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {savingInterval ? "Saving…" : intervalSaved ? "Saved!" : "Save"}
            </button>
          </div>
          {intervalError && <p className="text-xs text-red-500 mt-2">{intervalError}</p>}
        </div>

        {/* Service history */}
        <section>
          <div className="flex items-baseline gap-2 mb-4">
            <h2 className="text-lg font-semibold text-slate-800">Service history</h2>
            <span className="text-sm text-slate-400">{jobsList.length}</span>
          </div>

          {jobsList.length === 0 ? (
            <p className="text-slate-400 text-sm">No jobs found for this asset.</p>
          ) : (
            <div className="space-y-3">
              {jobsList.map((job) => {
                const isExpanded = expandedJobs.has(job.id);
                return (
                  <div key={job.id} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    {/* Collapsed header — always visible, click to expand */}
                    <button
                      onClick={() => toggleJob(job.id)}
                      className="w-full text-left px-6 py-5 hover:bg-slate-50 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-baseline gap-2">
                            <p className="font-bold text-slate-800">
                              {job.title ?? `Job #${job.jobNumber ?? "—"}`}
                            </p>
                            {job.jobNumber && job.title && (
                              <span className="text-xs text-slate-400 font-normal">#{job.jobNumber}</span>
                            )}
                          </div>
                          <p className="text-xs text-slate-400 capitalize">
                            {job.jobStatus.toLowerCase().replace(/_/g, " ")}
                            {job.technicianName && (
                              <span className="ml-2 text-slate-300">·</span>
                            )}
                            {job.technicianName && (
                              <span className="ml-2">{job.technicianName}</span>
                            )}
                          </p>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <p className="text-sm text-slate-400">{formatDate(job.completedAt)}</p>
                          <a
                            href={`${API}/api/jobs/${job.id}/pdf`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-xs font-semibold px-2.5 py-1 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 hover:border-slate-300 transition-colors"
                          >
                            PDF
                          </a>
                          <svg
                            className={`h-4 w-4 text-slate-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </div>
                    </button>

                    {/* Expanded detail */}
                    {isExpanded && (() => {
                      const notes = jobNotes[job.id];
                      const isLoadingNotes = loadingNotes.has(job.id);
                      const workNotes = notes?.workNotes ?? null;
                      const techName = notes?.technicianName ?? job.technicianName;

                      return (
                        <div className="border-t border-slate-100 px-6 py-5 space-y-5">

                          {/* Work carried out — most prominent section */}
                          {isLoadingNotes ? (
                            <p className="text-sm text-slate-400">Loading work notes…</p>
                          ) : workNotes ? (
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">Work carried out</p>
                              <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3">
                                <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{workNotes}</p>
                              </div>
                            </div>
                          ) : job.instructions ? (
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">Work carried out</p>
                              <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3">
                                <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{job.instructions}</p>
                              </div>
                            </div>
                          ) : null}

                          {/* Technician (from live visit data if available) */}
                          {techName && (
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">Technician</p>
                              <p className="text-sm text-slate-700 font-medium">{techName}</p>
                            </div>
                          )}

                          {/* Custom fields */}
                          {job.customFields.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">Job Details</p>
                              <div className="space-y-1">
                                {job.customFields.map((cf) => (
                                  <p key={cf.label} className="text-sm text-slate-500">
                                    <span className="font-medium text-slate-700">{cf.label}:</span>{" "}
                                    {cf.value ?? "—"}
                                  </p>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Empty state */}
                          {!isLoadingNotes && !workNotes && !job.instructions && !techName && job.customFields.length === 0 && (
                            <p className="text-sm text-slate-400">No additional details available.</p>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
          )}
        </section>

      </main>
    </div>
  );
}
