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

const statusConfig = {
  ok: {
    label: "OK",
    pill: "bg-green-100 text-green-700",
    border: "border-l-green-500",
  },
  amber: {
    label: "Due Soon",
    pill: "bg-amber-100 text-amber-700",
    border: "border-l-amber-500",
  },
  overdue: {
    label: "Overdue",
    pill: "bg-red-100 text-red-700",
    border: "border-l-red-500",
  },
  unscheduled: {
    label: "Unscheduled",
    pill: "bg-slate-100 text-slate-500",
    border: "border-l-slate-300",
  },
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
          {data.assets.length === 0 ? (
            <p className="text-slate-400 text-sm">No assets on record.</p>
          ) : (
            data.assets.map((asset) => {
              const { label, pill, border } = statusConfig[asset.status];
              return (
                <div
                  key={asset.id}
                  className={`bg-white rounded-xl shadow-sm border border-slate-200 border-l-4 ${border} px-6 py-5`}
                >
                  {/* Top row */}
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div>
                      <p className="font-bold text-slate-800 text-base">{asset.displayName}</p>
                      <p className="text-slate-400 text-xs mt-0.5">{asset.identifier}</p>
                    </div>
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold shrink-0 ${pill}`}>
                      {label}
                    </span>
                  </div>

                  {/* Metadata row */}
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
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="pt-4 border-t border-slate-200 text-center">
          <p className="text-slate-400 text-xs">Powered by AssetMinder</p>
        </div>

      </main>
    </div>
  );
}
