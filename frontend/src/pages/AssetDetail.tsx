import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
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

interface JobEntry {
  id: string;
  jobNumber: number | null;
  title: string | null;
  completedAt: string | null;
  jobStatus: string;
  customFields: { label: string; value: string | null }[];
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
  const jobberAccountId = localStorage.getItem("jobberAccountId");

  const [asset, setAsset] = useState<AssetDetail | null>(null);
  const [jobsList, setJobsList] = useState<JobEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [intervalInput, setIntervalInput] = useState<string>("");
  const [savingInterval, setSavingInterval] = useState(false);
  const [intervalSaved, setIntervalSaved] = useState(false);
  const [intervalError, setIntervalError] = useState<string | null>(null);

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
        body: JSON.stringify({ intervalDays: days }),
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
          to="/dashboard"
          className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-600 transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to dashboard
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
              {jobsList.map((job) => (
                <div key={job.id} className="bg-white rounded-xl shadow-sm border border-slate-200 px-6 py-5">
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
                      </p>
                      {job.customFields.length > 0 && (
                        <div className="pt-3 space-y-1 border-t border-slate-100 mt-3">
                          {job.customFields.map((cf) => (
                            <p key={cf.label} className="text-sm text-slate-500">
                              <span className="font-medium text-slate-700">{cf.label}:</span>{" "}
                              {cf.value ?? "—"}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                    <p className="text-sm text-slate-400 shrink-0 pt-0.5">{formatDate(job.completedAt)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

      </main>
    </div>
  );
}
