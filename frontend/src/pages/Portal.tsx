import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { API } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

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
  ok: { label: "OK", className: "bg-green-100 text-green-800" },
  amber: { label: "Due Soon", className: "bg-yellow-100 text-yellow-800" },
  overdue: { label: "Overdue", className: "bg-red-100 text-red-800" },
  unscheduled: { label: "Unscheduled", className: "bg-gray-100 text-gray-600" },
};

function StatusBadge({ status }: { status: PortalAsset["status"] }) {
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
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold">Portal not found</h1>
          <p className="text-muted-foreground">This link may have expired or is invalid.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-3xl mx-auto space-y-6">

        {/* Header */}
        <div>
          <p className="text-sm text-muted-foreground font-medium mb-1">Asset Service History</p>
          <h1 className="text-3xl font-bold tracking-tight">{data.client.name}</h1>
        </div>

        {/* Assets */}
        <Card>
          <CardHeader>
            <CardTitle>Your Assets</CardTitle>
          </CardHeader>
          <CardContent>
            {data.assets.length === 0 ? (
              <p className="text-sm text-muted-foreground">No assets on record.</p>
            ) : (
              <div className="divide-y">
                {data.assets.map((asset) => (
                  <div key={asset.id} className="flex items-center justify-between py-4 gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">{asset.displayName}</p>
                      <p className="text-sm text-muted-foreground">
                        {asset.jobCount} service record{asset.jobCount !== 1 ? "s" : ""}
                      </p>
                    </div>
                    <div className="text-sm text-right space-y-1 shrink-0">
                      <p className="text-muted-foreground">Last serviced: {formatDate(asset.lastServicedAt)}</p>
                      {asset.nextDueAt && (
                        <p className="text-muted-foreground">Next due: {formatDate(asset.nextDueAt)}</p>
                      )}
                    </div>
                    <StatusBadge status={asset.status} />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">Powered by AssetMinder</p>
      </div>
    </div>
  );
}
