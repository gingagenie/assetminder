import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface CustomField {
  id: string;
  label: string;
}

export default function Onboarding() {
  const navigate = useNavigate();
  const jobberAccountId = localStorage.getItem("jobberAccountId");

  const [fields, setFields] = useState<CustomField[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobberAccountId) { navigate("/"); return; }

    fetch(`/api/custom-fields?jobberAccountId=${encodeURIComponent(jobberAccountId)}`)
      .then((r) => r.json())
      .then((data: { fields: CustomField[] }) => setFields(data.fields))
      .catch(() => setError("Failed to load custom fields."))
      .finally(() => setLoading(false));
  }, [jobberAccountId, navigate]);

  async function handleSubmit() {
    if (!selected || !jobberAccountId) return;
    setSaving(true);
    try {
      const res = await fetch("/api/orgs/field-mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobberAccountId, fieldLabel: selected }),
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
            <p className="text-sm text-muted-foreground">
              No custom fields found on Jobs. Create one in Jobber under Settings → Custom Fields, then refresh.
            </p>
          ) : (
            <>
              <Select onValueChange={setSelected} value={selected}>
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
              <Button className="w-full" disabled={!selected || saving} onClick={handleSubmit}>
                {saving ? "Saving…" : "Continue"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
