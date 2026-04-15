import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { API } from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Copy, Check } from "lucide-react";

// ---------- Types ----------

interface Client {
  id: string;
  name: string;
  companyName: string | null;
  email: string | null;
  jobberClientId: string;
  portalToken: string | null;
  assetCount?: number;
}

// ---------- Portal link modal ----------

function PortalLinkModal({ open, url, onClose }: { open: boolean; url: string; onClose: () => void }) {
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
            {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4 text-slate-500" />}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Dashboard ----------

export default function Dashboard() {
  const navigate = useNavigate();
  const jobberAccountId = localStorage.getItem("jobberAccountId");

  const [accountName, setAccountName] = useState<string | null>(null);
  const [clientsList, setClientsList] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [portalUrl, setPortalUrl] = useState<string | null>(null);
  const [generatingFor, setGeneratingFor] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  async function loadDashboard() {
    if (!jobberAccountId) return;
    const [me, clientData, assetData] = await Promise.all([
      fetch(`${API}/api/me?jobberAccountId=${encodeURIComponent(jobberAccountId)}`).then((r) => r.json()),
      fetch(`${API}/api/clients?jobberAccountId=${encodeURIComponent(jobberAccountId)}`).then((r) => r.json()),
      fetch(`${API}/api/assets?jobberAccountId=${encodeURIComponent(jobberAccountId)}`).then((r) => r.json()),
    ]) as [{ accountName: string }, { clients: Client[] }, { assets: { jobberClientId: string | null }[] }];

    // Count assets per client
    const countMap = new Map<string, number>();
    for (const asset of assetData.assets) {
      if (!asset.jobberClientId) continue;
      countMap.set(asset.jobberClientId, (countMap.get(asset.jobberClientId) ?? 0) + 1);
    }
    const clients = clientData.clients.map((c) => ({
      ...c,
      assetCount: countMap.get(c.jobberClientId) ?? 0,
    }));

    setAccountName(me.accountName);
    setClientsList(clients);
  }

  useEffect(() => {
    if (!jobberAccountId) { navigate("/"); return; }
    loadDashboard().catch(() => setError("Failed to load dashboard data.")).finally(() => setLoading(false));
  }, [jobberAccountId, navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSync() {
    if (!jobberAccountId) return;
    setSyncing(true);
    setSyncError(null);
    try {
      await fetch(`${API}/api/sync`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobberAccountId }) });
      await fetch(`${API}/api/group-assets`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobberAccountId }) });
      await fetch(`${API}/api/calculate-due-dates`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobberAccountId }) });
      await loadDashboard();
    } catch {
      setSyncError("Sync failed. Please try again.");
      setTimeout(() => setSyncError(null), 4000);
    } finally {
      setSyncing(false);
    }
  }

  async function handleDisconnect() {
    if (!jobberAccountId) return;
    if (!window.confirm("Disconnect AssetMinder from Jobber? This will delete all synced data and revoke access. This cannot be undone.")) return;
    setDisconnecting(true);
    try {
      await fetch(`${API}/api/disconnect`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobberAccountId }) });
    } catch { /* continue */ } finally {
      localStorage.removeItem("jobberAccountId");
      navigate("/");
    }
  }

  async function handleSharePortal(e: React.MouseEvent, clientId: string) {
    e.preventDefault(); // don't navigate to client detail
    setGeneratingFor(clientId);
    try {
      const res = await fetch(`${API}/api/clients/${clientId}/portal-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobberAccountId }),
      });
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
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <span className="text-white font-semibold text-lg tracking-tight">AssetMinder</span>
          <div className="flex items-center gap-4">
            {accountName && (
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-green-400 shrink-0" />
                <span className="text-slate-300 text-sm hidden sm:block">
                  Connected as <span className="text-white font-medium">{accountName}</span>
                </span>
              </div>
            )}
            <button
              onClick={handleSync}
              disabled={syncing || disconnecting}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-white/10 text-white hover:bg-white/20 transition-colors disabled:opacity-50"
            >
              <svg className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {syncing ? "Syncing…" : "Sync Jobber"}
            </button>
            <button
              onClick={handleDisconnect}
              disabled={disconnecting || syncing}
              className="text-xs text-slate-400 hover:text-red-400 transition-colors disabled:opacity-50"
            >
              {disconnecting ? "Disconnecting…" : "Disconnect"}
            </button>
          </div>
        </div>
      </header>

      {syncError && (
        <div className="bg-red-50 border-b border-red-200 px-6 py-2 text-center">
          <p className="text-xs text-red-600 font-medium">{syncError}</p>
        </div>
      )}

      <main className="max-w-3xl mx-auto px-6 py-10">

        {/* Header */}
        <div className="flex items-baseline gap-2 mb-6">
          <h2 className="text-lg font-semibold text-slate-800">Clients</h2>
          <span className="text-sm text-slate-400">{clientsList.length}</span>
        </div>

        {clientsList.length === 0 ? (
          <p className="text-slate-400 text-sm">No clients found. Run a sync to populate.</p>
        ) : (
          <div className="space-y-3">
            {clientsList.map((client) => (
              <Link
                key={client.id}
                to={`/clients/${client.id}`}
                className="block bg-white rounded-xl shadow-sm border border-slate-200 hover:border-slate-300 hover:shadow transition-all overflow-hidden"
              >
                <div className="px-5 py-4 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-800 truncate">
                      {client.companyName ?? client.name}
                    </p>
                    <div className="flex items-center gap-3 mt-0.5">
                      {client.email && (
                        <p className="text-xs text-slate-400 truncate">{client.email}</p>
                      )}
                      <span className="text-xs text-slate-300">·</span>
                      <p className="text-xs text-slate-400 shrink-0">
                        {(client.assetCount ?? 0) === 0
                          ? "No assets"
                          : `${client.assetCount} asset${client.assetCount !== 1 ? "s" : ""}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      disabled={generatingFor === client.id}
                      onClick={(e) => handleSharePortal(e, client.id)}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 hover:border-slate-300 transition-colors disabled:opacity-50"
                    >
                      {generatingFor === client.id ? "Generating…" : "Share Portal"}
                    </button>
                    <svg
                      className="h-4 w-4 text-slate-400"
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>

      {portalUrl && (
        <PortalLinkModal open={!!portalUrl} url={portalUrl} onClose={() => setPortalUrl(null)} />
      )}
    </div>
  );
}
