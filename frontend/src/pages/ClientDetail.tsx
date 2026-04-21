import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { API } from "@/lib/api";
import { ChevronLeft } from "lucide-react";
import { Nav } from "@/components/Nav";

// ---------- Types ----------

interface Asset {
  id: string;
  identifier: string;
  displayName: string;
  jobberClientId: string | null;
  lastServicedAt: string | null;
  nextDueAt: string | null;
  jobCount: number;
  status: "ok" | "amber" | "overdue" | "unscheduled";
}

interface Client {
  id: string;
  name: string;
  companyName: string | null;
  email: string | null;
  jobberClientId: string;
  portalToken: string | null;
}

// ---------- Helpers ----------

const statusConfig = {
  ok:          { label: "OK",          pill: "bg-green-100 text-green-700", border: "border-l-green-500" },
  amber:       { label: "Due Soon",    pill: "bg-amber-100 text-amber-700", border: "border-l-amber-500" },
  overdue:     { label: "Overdue",     pill: "bg-red-100 text-red-700",     border: "border-l-red-500"   },
  unscheduled: { label: "Unscheduled", pill: "bg-slate-100 text-slate-500", border: "border-l-slate-300" },
};

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
}

// ---------- ClientDetail ----------

export default function ClientDetail() {
  const { clientId } = useParams<{ clientId: string }>();
  const navigate = useNavigate();
  const jobberAccountId = localStorage.getItem("jobberAccountId");

  const [client, setClient] = useState<Client | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadData() {
    if (!jobberAccountId || !clientId) return;
    const [clientData, assetData] = await Promise.all([
      fetch(`${API}/api/clients?jobberAccountId=${encodeURIComponent(jobberAccountId)}`).then((r) => r.json()),
      fetch(`${API}/api/assets?jobberAccountId=${encodeURIComponent(jobberAccountId)}`).then((r) => r.json()),
    ]);
    const found = (clientData.clients as Client[]).find((c) => c.id === clientId) ?? null;
    setClient(found);
    setAssets(found
      ? (assetData.assets as Asset[]).filter((a) => a.jobberClientId === found.jobberClientId)
      : []);
  }

  useEffect(() => {
    if (!jobberAccountId) { navigate("/"); return; }
    if (!clientId) { navigate("/dashboard"); return; }
    loadData().catch(() => setError("Failed to load client data.")).finally(() => setLoading(false));
  }, [clientId, jobberAccountId, navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div style={{ fontFamily: "Inter, sans-serif" }} className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-slate-400 text-sm">Loading…</p>
      </div>
    );
  }

  if (error || !client) {
    return (
      <div style={{ fontFamily: "Inter, sans-serif" }} className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-red-500 text-sm">{error ?? "Client not found."}</p>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "Inter, sans-serif", backgroundColor: "#f8fafc" }} className="min-h-screen">

      <Nav
        left={
          <>
            <button
              onClick={() => navigate("/dashboard")}
              className="flex items-center gap-1 text-slate-400 hover:text-white transition-colors shrink-0"
            >
              <ChevronLeft className="h-4 w-4" />
              <span className="text-sm">Clients</span>
            </button>
            <span className="text-slate-600 text-sm">/</span>
            <span className="text-white font-semibold text-sm truncate">
              {client.companyName ?? client.name}
            </span>
          </>
        }
        onSyncComplete={loadData}
      />

      <main className="max-w-3xl mx-auto px-6 py-10">

        {/* Client header */}
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-slate-800">{client.companyName ?? client.name}</h1>
          {client.email && (
            <p className="text-sm text-slate-400 mt-0.5">{client.email}</p>
          )}
        </div>

        {/* Assets */}
        <div className="flex items-baseline gap-2 mb-4">
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Assets</h2>
          <span className="text-sm text-slate-400">{assets.length}</span>
        </div>

        {assets.length === 0 ? (
          <p className="text-slate-400 text-sm">No assets tracked for this client.</p>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden divide-y divide-slate-100">
            {assets.map((asset) => {
              const { label, pill, border } = statusConfig[asset.status];
              return (
                <Link
                  key={asset.id}
                  to={`/assets/${asset.id}`}
                  state={{ clientId: client.id, clientName: client.companyName ?? client.name }}
                  className={`flex items-center justify-between gap-4 px-5 py-4 border-l-4 ${border} hover:bg-slate-50 transition-colors`}
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-800 text-sm">{asset.displayName}</p>
                    <div className="flex items-center gap-4 mt-1.5">
                      <span className="text-xs text-slate-400">
                        Last: <span className="text-slate-600">{formatDate(asset.lastServicedAt)}</span>
                      </span>
                      <span className="text-xs text-slate-400">
                        Due: <span className="text-slate-600">{formatDate(asset.nextDueAt)}</span>
                      </span>
                      <span className="text-xs text-slate-400">
                        {asset.jobCount} job{asset.jobCount !== 1 ? "s" : ""}
                      </span>
                    </div>
                  </div>
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold shrink-0 ${pill}`}>
                    {label}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
