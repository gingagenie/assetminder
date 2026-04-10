import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { API } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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
  ok: { label: "OK", className: "bg-green-100 text-green-800" },
  amber: { label: "Due Soon", className: "bg-yellow-100 text-yellow-800" },
  overdue: { label: "Overdue", className: "bg-red-100 text-red-800" },
  unscheduled: { label: "Unscheduled", className: "bg-gray-100 text-gray-600" },
};

function StatusBadge({ status }: { status: AssetDetail["status"] }) {
  const { label, className } = statusConfig[status];
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", className)}>
      {label}
    </span>
  );
}

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

    try {
      // Save interval
      await fetch(`${API}/api/assets/${asset.id}/interval`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intervalDays: days }),
      });

      // Recalculate due dates
      await fetch(`${API}/api/calculate-due-dates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobberAccountId }),
      });

      // Refresh asset data
      const res = await fetch(`${API}/api/assets/${asset.id}/jobs`);
      const data = (await res.json()) as { asset: AssetDetail; jobs: JobEntry[] };
      setAsset(data.asset);
      setJobsList(data.jobs);
    } catch {
      setIntervalError("Failed to save interval. Please try again.");
    } finally {
      setSavingInterval(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (error || !asset) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-destructive">{error ?? "Asset not found."}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-3xl mx-auto space-y-6">

        {/* Back */}
        <Link to="/dashboard" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ChevronLeft className="h-4 w-4" />
          Back to dashboard
        </Link>

        {/* Header */}
        <div className="space-y-1">
          {asset.clientName && (
            <p className="text-sm text-muted-foreground font-medium">{asset.clientName}</p>
          )}
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight">{asset.displayName}</h1>
            <StatusBadge status={asset.status} />
          </div>
          <div className="flex gap-6 text-sm text-muted-foreground pt-1">
            <span>Last serviced: {formatDate(asset.lastServicedAt)}</span>
            {asset.nextDueAt && <span>Next due: {formatDate(asset.nextDueAt)}</span>}
            <span>{asset.jobCount} job{asset.jobCount !== 1 ? "s" : ""}</span>
          </div>
        </div>

        {/* Service interval */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Service interval</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={1}
                value={intervalInput}
                onChange={(e) => setIntervalInput(e.target.value)}
                placeholder="e.g. 90"
                className="h-10 w-32 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <span className="text-sm text-muted-foreground">days</span>
              <Button size="sm" onClick={handleSaveInterval} disabled={savingInterval}>
                {savingInterval ? "Saving…" : "Save"}
              </Button>
            </div>
            {intervalError && <p className="text-sm text-destructive mt-2">{intervalError}</p>}
          </CardContent>
        </Card>

        {/* Job timeline */}
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Service history</h2>
          {jobsList.length === 0 ? (
            <p className="text-sm text-muted-foreground">No jobs found for this asset.</p>
          ) : (
            jobsList.map((job) => (
              <Card key={job.id}>
                <CardContent className="pt-5 pb-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1 min-w-0">
                      <p className="font-medium">
                        {job.title ?? `Job #${job.jobNumber ?? "—"}`}
                        {job.jobNumber && job.title && (
                          <span className="ml-2 text-sm text-muted-foreground font-normal">#{job.jobNumber}</span>
                        )}
                      </p>
                      <p className="text-sm text-muted-foreground capitalize">
                        {job.jobStatus.toLowerCase().replace(/_/g, " ")}
                      </p>
                      {job.customFields.length > 0 && (
                        <div className="pt-2 space-y-0.5">
                          {job.customFields.map((cf) => (
                            <p key={cf.label} className="text-sm text-muted-foreground">
                              <span className="font-medium text-foreground">{cf.label}:</span>{" "}
                              {cf.value ?? "—"}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground shrink-0">{formatDate(job.completedAt)}</p>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>

      </div>
    </div>
  );
}
