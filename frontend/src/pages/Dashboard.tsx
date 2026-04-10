import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
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
  ok: { label: "OK", className: "bg-green-100 text-green-800" },
  amber: { label: "Due Soon", className: "bg-yellow-100 text-yellow-800" },
  overdue: { label: "Overdue", className: "bg-red-100 text-red-800" },
  unscheduled: { label: "Unscheduled", className: "bg-gray-100 text-gray-600" },
};

function StatusBadge({ status }: { status: Asset["status"] }) {
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Client portal link</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground mb-3">
          Share this link with your client. It gives them read-only access to their asset service history.
        </p>
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={url}
            className="flex-1 h-10 rounded-md border border-input bg-muted px-3 py-2 text-sm"
          />
          <Button size="icon" variant="outline" onClick={handleCopy}>
            {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
          </Button>
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
  const [assets, setAssets] = useState<Asset[]>([]);
  const [clientsList, setClientsList] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [portalUrl, setPortalUrl] = useState<string | null>(null);
  const [generatingFor, setGeneratingFor] = useState<string | null>(null);

  useEffect(() => {
    if (!jobberAccountId) { navigate("/"); return; }

    Promise.all([
      fetch(`/api/me?jobberAccountId=${encodeURIComponent(jobberAccountId)}`).then((r) => r.json()),
      fetch(`/api/assets?jobberAccountId=${encodeURIComponent(jobberAccountId)}`).then((r) => r.json()),
      fetch(`/api/clients?jobberAccountId=${encodeURIComponent(jobberAccountId)}`).then((r) => r.json()),
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
      const res = await fetch(`/api/clients/${clientId}/portal-link`, { method: "POST" });
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
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-destructive">{error}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-4xl mx-auto space-y-6">

        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold tracking-tight">AssetMinder</h1>
          {accountName && (
            <p className="text-muted-foreground mt-1">
              Connected as <span className="font-medium text-foreground">{accountName}</span>
            </p>
          )}
        </div>

        {/* Clients */}
        <Card>
          <CardHeader>
            <CardTitle>Clients</CardTitle>
          </CardHeader>
          <CardContent>
            {clientsList.length === 0 ? (
              <p className="text-sm text-muted-foreground">No clients found. Run a sync to populate.</p>
            ) : (
              <div className="divide-y">
                {clientsList.map((client) => (
                  <div key={client.id} className="flex items-center justify-between py-4 gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{client.companyName ?? client.name}</p>
                      {client.email && <p className="text-sm text-muted-foreground">{client.email}</p>}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={generatingFor === client.id}
                      onClick={() => handleSharePortal(client.id)}
                    >
                      {generatingFor === client.id ? "Generating…" : "Share Portal"}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Assets */}
        <Card>
          <CardHeader>
            <CardTitle>Assets</CardTitle>
          </CardHeader>
          <CardContent>
            {assets.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No assets found. Run a sync and group assets to populate this list.
              </p>
            ) : (
              <div className="divide-y">
                {assets.map((asset) => (
                  <Link
                    key={asset.id}
                    to={`/assets/${asset.id}`}
                    className="flex items-center justify-between py-4 gap-4 hover:bg-muted/50 -mx-6 px-6 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">{asset.displayName}</p>
                      <p className="text-sm text-muted-foreground">{asset.jobCount} job{asset.jobCount !== 1 ? "s" : ""}</p>
                    </div>
                    <div className="text-sm text-right space-y-1 shrink-0">
                      <p className="text-muted-foreground">Last serviced: {formatDate(asset.lastServicedAt)}</p>
                      {asset.nextDueAt && (
                        <p className="text-muted-foreground">Next due: {formatDate(asset.nextDueAt)}</p>
                      )}
                    </div>
                    <StatusBadge status={asset.status} />
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

      </div>

      {/* Portal link modal */}
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
