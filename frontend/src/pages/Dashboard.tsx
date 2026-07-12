import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { API } from "@/lib/api";
import { SubscriptionWall } from "@/components/SubscriptionWall";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Copy, Check, Share2 } from "lucide-react";
import { Nav } from "@/components/Nav";

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

  const [subscriptionRequired, setSubscriptionRequired] = useState(false);
  const [accountName, setAccountName] = useState<string | null>(null);
  const [clientsList, setClientsList] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [portalUrl, setPortalUrl] = useState<string | null>(null);
  const [generatingFor, setGeneratingFor] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [clientSearch, setClientSearch] = useState("");
  const [unassignedCount, setUnassignedCount] = useState(0);

  // Settings state
  const [keywordsInput, setKeywordsInput] = useState("");
  const [savingKeywords, setSavingKeywords] = useState(false);
  const [keywordsSaved, setKeywordsSaved] = useState(false);

  // Asset field state
  const [assetFieldLabel, setAssetFieldLabel] = useState<string | null>(null);
  const [assetFieldId, setAssetFieldId] = useState<string | null>(null);
  const [showFieldPicker, setShowFieldPicker] = useState(false);
  const [availableFields, setAvailableFields] = useState<{ id: string; label: string }[]>([]);
  const [selectedFieldLabel, setSelectedFieldLabel] = useState("");
  const [selectedFieldId, setSelectedFieldId] = useState("");
  const [loadingFields, setLoadingFields] = useState(false);
  const [savingField, setSavingField] = useState(false);

  async function loadDashboard() {
    if (!jobberAccountId) return;

    // Check subscription status first — this endpoint is never blocked by the subscription middleware
    const billingRes = await fetch(`${API}/api/billing/status`);
    if (billingRes.ok) {
      const billing = (await billingRes.json()) as { subscriptionStatus: string; trialDaysLeft: number; trialExpired: boolean };
      if (billing.trialExpired || billing.subscriptionStatus === "expired") {
        setSubscriptionRequired(true);
        return;
      }
    }

    const meRes = await fetch(`${API}/api/me`);
    if (!meRes.ok) {
      if (meRes.status === 402) {
        setSubscriptionRequired(true);
        return;
      }
      localStorage.removeItem("jobberAccountId");
      navigate("/");
      return;
    }

    const [me, clientData, assetData, settingsData, fieldData] = await Promise.all([
      meRes.json(),
      fetch(`${API}/api/clients`).then((r) => r.json()),
      fetch(`${API}/api/assets`).then((r) => r.json()),
      fetch(`${API}/api/settings`).then((r) => r.json()),
      fetch(`${API}/api/orgs/field-mapping`).then((r) => r.json()),
    ]) as [
      { accountName: string },
      { clients: Client[] },
      { assets: { jobberClientId: string | null }[] },
      { serviceKeywords: string[] },
      { assetIdentifierField: string | null; assetIdentifierFieldId: string | null },
    ];

    const countMap = new Map<string, number>();
    for (const asset of assetData.assets) {
      if (!asset.jobberClientId) continue;
      countMap.set(asset.jobberClientId, (countMap.get(asset.jobberClientId) ?? 0) + 1);
    }
    setAccountName(me.accountName);
    setClientsList(clientData.clients.map((c) => ({
      ...c,
      assetCount: countMap.get(c.jobberClientId) ?? 0,
    })));
    setKeywordsInput((settingsData.serviceKeywords ?? []).join(", "));
    setAssetFieldLabel(fieldData.assetIdentifierField);
    setAssetFieldId(fieldData.assetIdentifierFieldId);

    // Fetch unassigned count — soft failure, defaults to 0
    const unassignedRes = await fetch(
      `${API}/api/stats/unassigned-count`
    ).catch(() => null);
    if (unassignedRes?.ok) {
      const { count } = (await unassignedRes.json()) as { count: number };
      setUnassignedCount(count);
    }
  }

  useEffect(() => {
    if (!jobberAccountId) { navigate("/"); return; }
    loadDashboard().catch(() => setError("Failed to load dashboard data.")).finally(() => setLoading(false));
  }, [jobberAccountId, navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll /api/me every 30s — if the org has been disconnected, clear session and redirect
  useEffect(() => {
    if (!jobberAccountId) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API}/api/me`);
        if (!res.ok) {
          clearInterval(interval);
          localStorage.removeItem("jobberAccountId");
          navigate("/");
        }
      } catch {
        // network error — wait for next poll
      }
    }, 30_000);
    return () => clearInterval(interval);
  }, [jobberAccountId, navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleDisconnect() {
    if (!jobberAccountId) return;
    if (!window.confirm("Disconnecting will cancel your AssetMinder subscription immediately and permanently delete your stored data. This cannot be undone.")) return;
    setDisconnecting(true);
    try {
      await fetch(`${API}/api/disconnect`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    } catch { /* continue */ } finally {
      navigate("/disconnected");
    }
  }

  async function handleSharePortal(e: React.MouseEvent, clientId: string) {
    e.preventDefault();
    setGeneratingFor(clientId);
    try {
      const res = await fetch(`${API}/api/clients/${clientId}/portal-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as { portalUrl: string };
      setPortalUrl(data.portalUrl);
    } catch {
      alert("Failed to generate portal link.");
    } finally {
      setGeneratingFor(null);
    }
  }

  async function handleOpenFieldPicker() {
    if (!jobberAccountId) return;
    setShowFieldPicker(true);
    setLoadingFields(true);
    try {
      const res = await fetch(`${API}/api/custom-fields`);
      const data = (await res.json()) as { fields: { id: string; label: string }[] };
      setAvailableFields(data.fields);
      setSelectedFieldLabel(assetFieldLabel ?? "");
      setSelectedFieldId(assetFieldId ?? "");
    } catch {
      // silent — fields array stays empty
    } finally {
      setLoadingFields(false);
    }
  }

  async function handleSaveField() {
    if (!jobberAccountId || !selectedFieldLabel) return;
    setSavingField(true);
    try {
      await fetch(`${API}/api/orgs/field-mapping`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fieldLabel: selectedFieldLabel, fieldId: selectedFieldId || undefined }),
      });
      setAssetFieldLabel(selectedFieldLabel);
      setAssetFieldId(selectedFieldId || null);
      setShowFieldPicker(false);
    } catch {
      // silent
    } finally {
      setSavingField(false);
    }
  }

  async function handleSaveKeywords() {
    if (!jobberAccountId) return;
    setSavingKeywords(true);
    setKeywordsSaved(false);
    try {
      const keywords = keywordsInput
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean);
      await fetch(`${API}/api/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceKeywords: keywords }),
      });
      setKeywordsSaved(true);
      setTimeout(() => setKeywordsSaved(false), 2500);
    } catch {
      // silent
    } finally {
      setSavingKeywords(false);
    }
  }

  if (subscriptionRequired) {
    return <SubscriptionWall />;
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

      <Nav
        left={
          <span className="text-white font-semibold text-lg tracking-tight">AssetMinder</span>
        }
        right={
          <>
            {accountName && (
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-green-400 shrink-0" />
                <span className="text-slate-300 text-sm hidden sm:block">
                  Connected as <span className="text-white font-medium">{accountName}</span>
                </span>
              </div>
            )}
            <button
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="text-xs text-slate-400 hover:text-red-400 transition-colors disabled:opacity-50"
            >
              {disconnecting ? "Disconnecting…" : "Disconnect"}
            </button>
          </>
        }
        onSyncComplete={loadDashboard}
      />

      <main className="px-6 py-8">

        {/* Unassigned jobs banner — unchanged */}
        {unassignedCount > 0 && (
          <div className="mb-6 flex items-center justify-between gap-4 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4">
            <p className="text-sm font-medium text-amber-800">
              You have {unassignedCount} job{unassignedCount !== 1 ? "s" : ""} not yet linked to an asset.
            </p>
            <Link
              to="/unassigned-jobs"
              className="shrink-0 text-sm font-semibold px-4 py-1.5 rounded-lg bg-amber-800 text-white hover:bg-amber-900 transition-colors"
            >
              Group them
            </Link>
          </div>
        )}

        {/* Two-column layout */}
        <div className="grid grid-cols-1 md:grid-cols-[1fr_200px] gap-4 items-start">

          {/* LEFT: Clients */}
          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-slate-800">Clients</h2>
                <span className="text-xs text-slate-400">{clientsList.length}</span>
              </div>
              <input
                type="text"
                value={clientSearch}
                onChange={(e) => setClientSearch(e.target.value)}
                placeholder="Search clients..."
                className="w-48 px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300"
              />
            </div>

            {clientsList.length === 0 ? (
              <p className="text-slate-400 text-sm">No clients found. Run a sync to populate.</p>
            ) : (
              (() => {
                const query = clientSearch.trim().toLowerCase();
                const filtered = query
                  ? clientsList.filter(
                      (c) =>
                        (c.companyName ?? c.name).toLowerCase().includes(query) ||
                        (c.email ?? "").toLowerCase().includes(query)
                    )
                  : clientsList;

                if (filtered.length === 0) {
                  return <p className="text-slate-400 text-xs">No clients match your search.</p>;
                }

                return (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "10px" }}>
                    {filtered.map((client) => (
                      <div
                        key={client.id}
                        onClick={() => navigate(`/clients/${client.id}`)}
                        className="border border-slate-200 rounded-md p-3 bg-white hover:border-slate-300 hover:shadow-sm transition-all cursor-pointer flex flex-col gap-2"
                      >
                        <p className="text-base font-semibold text-slate-900 truncate">
                          {client.companyName ?? client.name}
                        </p>
                        {(client.assetCount ?? 0) === 0 ? (
                          <p className="text-[11px] text-slate-500">0 assets</p>
                        ) : (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/clients/${client.id}/assets`, {
                                state: { clientName: client.companyName ?? client.name },
                              });
                            }}
                            className="text-[11px] text-slate-500 hover:text-slate-800 hover:underline transition-colors text-left"
                          >
                            {client.assetCount} asset{client.assetCount !== 1 ? "s" : ""}
                          </button>
                        )}
                        <button
                          disabled={generatingFor === client.id}
                          onClick={(e) => { e.stopPropagation(); handleSharePortal(e, client.id); }}
                          className="mt-auto w-full h-8 flex items-center justify-center gap-1.5 rounded-md bg-slate-900 text-white text-xs font-medium hover:bg-slate-700 transition-colors disabled:opacity-50"
                        >
                          <Share2 className="h-3 w-3" />
                          {generatingFor === client.id ? "Generating…" : "Share Portal"}
                        </button>
                      </div>
                    ))}
                  </div>
                );
              })()
            )}
          </div>

          {/* RIGHT: Settings sidebar */}
          <div className="flex flex-col gap-3">

            {/* Service keywords */}
            <div className="bg-white rounded-lg border border-slate-200 p-4">
              <div className="flex items-center gap-1.5 mb-3">
                <p className="text-xs font-medium text-slate-700">Service filter keywords</p>
                <div className="relative flex items-center group">
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400 cursor-default shrink-0">
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
                  </svg>
                  <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 rounded-lg bg-slate-800 px-3 py-2.5 text-xs text-slate-200 leading-relaxed shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-50">
                    AssetMinder uses these keywords to identify which Jobber jobs count as a service visit. Only jobs whose title contains one of these keywords will update an asset's last serviced date and calculate the next due date. Separate multiple keywords with commas. Leave blank to count all jobs.
                    <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-800" />
                  </div>
                </div>
              </div>
              <input
                type="text"
                value={keywordsInput}
                onChange={(e) => setKeywordsInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSaveKeywords()}
                placeholder="e.g. Annual Service, PM"
                className="w-full h-8 rounded-md border border-slate-200 bg-slate-50 px-2.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-300 mb-2"
              />
              <button
                onClick={handleSaveKeywords}
                disabled={savingKeywords}
                style={{ backgroundColor: savingKeywords ? undefined : "#1e293b" }}
                className="w-full h-8 rounded-md text-xs font-semibold text-white bg-slate-700 hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {savingKeywords ? "Saving…" : keywordsSaved ? "Saved!" : "Save"}
              </button>
            </div>

            {/* Asset grouping field */}
            <div className="bg-white rounded-lg border border-slate-200 p-4">
              <p className="text-xs font-medium text-slate-700 mb-3">Asset grouping field</p>
              {!showFieldPicker ? (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-slate-700 truncate">
                    {assetFieldLabel
                      ? <span className="font-medium">{assetFieldLabel}</span>
                      : <span className="text-slate-400 italic">Not configured</span>}
                  </span>
                  <button
                    onClick={handleOpenFieldPicker}
                    className="text-xs font-semibold px-2.5 py-1 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100 transition-colors shrink-0"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {loadingFields ? (
                    <p className="text-xs text-slate-400">Loading fields…</p>
                  ) : availableFields.length === 0 ? (
                    <p className="text-xs text-slate-400">No custom fields found on Jobs.</p>
                  ) : (
                    <select
                      value={selectedFieldLabel}
                      onChange={(e) => {
                        const label = e.target.value;
                        setSelectedFieldLabel(label);
                        setSelectedFieldId(availableFields.find((f) => f.label === label)?.id ?? "");
                      }}
                      className="w-full h-8 rounded-md border border-slate-200 bg-slate-50 px-2 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-300"
                    >
                      <option value="" disabled>Select a field…</option>
                      {availableFields.map((f) => (
                        <option key={f.id} value={f.label}>{f.label}</option>
                      ))}
                    </select>
                  )}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleSaveField}
                      disabled={savingField || !selectedFieldLabel}
                      style={{ backgroundColor: savingField ? undefined : "#1e293b" }}
                      className="h-8 px-3 rounded-md text-xs font-semibold text-white bg-slate-700 hover:opacity-90 transition-opacity disabled:opacity-50"
                    >
                      {savingField ? "Saving…" : "Save"}
                    </button>
                    <button
                      onClick={() => setShowFieldPicker(false)}
                      className="h-8 px-3 rounded-md text-xs text-slate-500 border border-slate-200 hover:bg-slate-50 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>

          </div>
        </div>

      </main>

      {portalUrl && (
        <PortalLinkModal open={!!portalUrl} url={portalUrl} onClose={() => setPortalUrl(null)} />
      )}
    </div>
  );
}
