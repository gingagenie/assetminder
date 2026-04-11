import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { API } from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Copy, Check } from "lucide-react";

// ---------- Types ----------

interface Asset {
  id: string;
  identifier: string;
  displayName: string;
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

// ---------- Portal link modal ----------

function PortalLinkModal({
  open,
  url,
  onClose,
}: {
  open: boolean;
  url: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent style={{ fontFamily: "Inter, sans-serif" }}>
        <DialogHeader>
          <DialogTitle className="text-slate-800">Client portal link</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-slate-500 mb-3">
          Share this link with your client. It gives them read-only access to their asset service history.
        </p>
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={url}
            className="flex-1 h-10 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none"
          />
          <button
            onClick={handleCopy}
            className="h-10 w-10 flex items-center justify-center rounded-lg border border-slate-200 bg-white hover:bg-slate-50 transition-colors"
          >
            {copied
              ? <Check className="h-4 w-4 text-green-600" />
              : <Copy className="h-4 w-4 text-slate-500" />}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Section header ----------

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-baseline gap-2 mb-4">
      <h2 className="text-lg font-semibold text-slate-800">{title}</h2>
      <span className="text-sm text-slate-400">{count}</span>
    </div>
  );
}

// ---------- Dashboard ----------

export default function Dashboard() {
  const navigate = useNavigate();
  const jobberAccountId = localStorage.getItem("jobberAccountId");

  const [accountName, setAccountName] = useState<string | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [clientsList, setClientsList] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [portalUrl, setPortalUrl] = useState<string | null>(null);
  const [generatingFor, setGeneratingFor] = useState<string | null>(null);

  useEffect(() => {
    if (!jobberAccountId) { navigate("/"); return; }

    Promise.all([
      fetch(`${API}/api/me?jobberAccountId=${encodeURIComponent(jobberAccountId)}`).then((r) => r.json()),
      fetch(`${API}/api/assets?jobberAccountId=${encodeURIComponent(jobberAccountId)}`).then((r) => r.json()),
      fetch(`${API}/api/clients?jobberAccountId=${encodeURIComponent(jobberAccountId)}`).then((r) => r.json()),
    ])
      .then(([me, assetData, clientData]: [
        { accountName: string },
        { assets: Asset[] },
        { clients: Client[] }
      ]) => {
        setAccountName(me.accountName);
        setAssets(assetData.assets);
        setClientsList(clientData.clients);
      })
      .catch(() => setError("Failed to load dashboard data."))
      .finally(() => setLoading(false));
  }, [jobberAccountId, navigate]);

  async function handleSharePortal(clientId: string) {
    setGeneratingFor(clientId);
    try {
      const res = await fetch(`${API}/api/clients/${clientId}/portal-link`, { method: "POST" });
      const data = (await res.json()) as { portalUrl: string };
      setPortalUrl(data.portalUrl);
    } catch {
      alert("Failed to generate portal link.");
    } finally {
      setGeneratingFor(null);
    }
  }

  if (loading) {
    return (
      <div style={{ fontFamily: "Inter, sans-serif" }} className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-slate-400 text-sm">Loading…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ fontFamily: "Inter, sans-serif" }} className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-red-500 text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "Inter, sans-serif", backgroundColor: "#f8fafc" }} className="min-h-screen">

      {/* Nav */}
      <header style={{ backgroundColor: "#1e293b" }}>
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <span className="text-white font-semibold text-lg tracking-tight">AssetMinder</span>
          {accountName && (
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-green-400 shrink-0" />
              <span className="text-slate-300 text-sm">Connected as <span className="text-white font-medium">{accountName}</span></span>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10 space-y-10">

        {/* Clients section */}
        <section>
          <SectionHeader title="Clients" count={clientsList.length} />
          {clientsList.length === 0 ? (
            <p className="text-slate-400 text-sm">No clients found. Run a sync to populate.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {clientsList.map((client) => (
                <div key={client.id} className="bg-white rounded-xl shadow-sm px-5 py-4 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-800 truncate">{client.companyName ?? client.name}</p>
                    {client.email && <p className="text-xs text-slate-400 mt-0.5 truncate">{client.email}</p>}
                  </div>
                  <button
                    disabled={generatingFor === client.id}
                    onClick={() => handleSharePortal(client.id)}
                    className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-colors disabled:opacity-50"
                  >
                    {generatingFor === client.id ? "Generating…" : "Share Portal"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Assets section */}
        <section>
          <SectionHeader title="Assets" count={assets.length} />
          {assets.length === 0 ? (
            <p className="text-slate-400 text-sm">No assets found. Run a sync and group assets to populate this list.</p>
          ) : (
            <div className="space-y-3">
              {assets.map((asset) => {
                const { label, pill, border } = statusConfig[asset.status];
                return (
                  <Link
                    key={asset.id}
                    to={`/assets/${asset.id}`}
                    className={`block bg-white rounded-xl shadow-sm border-l-4 ${border} px-6 py-5 hover:shadow-md transition-shadow`}
                  >
                    <div className="flex items-start justify-between gap-4 mb-4">
                      <div>
                        <p className="font-bold text-slate-800 text-base">{asset.displayName}</p>
                        <p className="text-slate-400 text-xs mt-0.5">{asset.identifier}</p>
                      </div>
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold shrink-0 ${pill}`}>
                        {label}
                      </span>
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
                  </Link>
                );
              })}
            </div>
          )}
        </section>

      </main>

      {portalUrl && (
        <PortalLinkModal
          open={!!portalUrl}
          url={portalUrl}
          onClose={() => setPortalUrl(null)}
        />
      )}
    </div>
  );
}
