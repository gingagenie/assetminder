import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { API } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SubscriptionWall } from "@/components/SubscriptionWall";

interface CustomField {
  id: string;
  label: string;
}

export default function Onboarding() {
  const navigate = useNavigate();
  const jobberAccountId = localStorage.getItem("jobberAccountId");

  const [subscriptionRequired, setSubscriptionRequired] = useState(false);
  const [fields, setFields] = useState<CustomField[]>([]);
  const [selectedLabel, setSelectedLabel] = useState<string>("");
  const [selectedId, setSelectedId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [autoCreating, setAutoCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobberAccountId) { navigate("/"); return; }

    (async () => {
      try {
        // Check subscription before touching any protected API
        const billingRes = await fetch(`${API}/api/billing/status`);
        if (billingRes.ok) {
          const billing = (await billingRes.json()) as { subscriptionStatus: string; trialExpired: boolean };
          if (billing.trialExpired || billing.subscriptionStatus === "expired") {
            setSubscriptionRequired(true);
            setLoading(false);
            return;
          }
        }

        const r = await fetch(`${API}/api/custom-fields`);
        if (r.status === 402) {
          setSubscriptionRequired(true);
          return;
        }
        if (!r.ok) {
          setError("Failed to load custom fields.");
          return;
        }
        const data = (await r.json()) as { fields: CustomField[] };
        setFields(data.fields ?? []);
      } catch {
        setError("Failed to load custom fields.");
      } finally {
        setLoading(false);
      }
    })();
  }, [jobberAccountId, navigate]);

  if (subscriptionRequired) {
    return <SubscriptionWall />;
  }

  async function handleAutoCreate() {
    if (!jobberAccountId) return;
    setAutoCreating(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/orgs/setup-asset-field`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Auto-create failed");
      navigate("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create field. Please try again.");
      setAutoCreating(false);
    }
  }

  async function handleSubmit() {
    if (!selectedLabel || !jobberAccountId) return;
    setSaving(true);
    try {
      const res = await fetch(`${API}/api/orgs/field-mapping`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fieldLabel: selectedLabel, fieldId: selectedId || undefined }),
      });
      if (!res.ok) throw new Error("Failed to save mapping");
      navigate("/dashboard");
    } catch {
      setError("Failed to save field mapping. Please try again.");
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Set up asset tracking</CardTitle>
          <p className="text-sm text-muted-foreground pt-1">
            Choose the Jobber custom field that identifies each asset (e.g. Serial Number).
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && <p className="text-sm text-destructive">{error}</p>}
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading fields…</p>
          ) : fields.length === 0 ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                No custom fields found on Jobs. AssetMinder can create one called <strong>Asset ID</strong> in your Jobber account automatically.
              </p>
              <Button className="w-full" disabled={autoCreating} onClick={handleAutoCreate}>
                {autoCreating ? "Creating field…" : "Create Asset ID field automatically"}
              </Button>
            </div>
          ) : (
            <>
              <Select
                onValueChange={(label) => {
                  setSelectedLabel(label);
                  setSelectedId(fields.find((f) => f.label === label)?.id ?? "");
                }}
                value={selectedLabel}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a custom field…" />
                </SelectTrigger>
                <SelectContent>
                  {fields.map((f) => (
                    <SelectItem key={f.id} value={f.label}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button className="w-full" disabled={!selectedLabel || saving} onClick={handleSubmit}>
                {saving ? "Saving…" : "Continue"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
