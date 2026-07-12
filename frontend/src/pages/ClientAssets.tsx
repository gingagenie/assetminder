import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, useLocation, Link } from "react-router-dom";
import { ChevronLeft, Pencil, Trash2, GitMerge, Check, X } from "lucide-react";
import { Nav } from "@/components/Nav";
import { API } from "@/lib/api";

interface Asset {
  id: string;
  displayName: string;
  jobCount: number;
  status: "ok" | "amber" | "overdue" | "unscheduled";
}

const statusPill: Record<Asset["status"], string> = {
  ok: "bg-green-100 text-green-700",
  amber: "bg-amber-100 text-amber-700",
  overdue: "bg-red-100 text-red-700",
  unscheduled: "bg-slate-100 text-slate-500",
};

const statusLabel: Record<Asset["status"], string> = {
  ok: "OK",
  amber: "Due soon",
  overdue: "Overdue",
  unscheduled: "Unscheduled",
};

export default function ClientAssets() {
  const { clientId } = useParams<{ clientId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const clientName = (location.state as { clientName?: string } | null)?.clientName ?? "Client";
  const jobberAccountId = localStorage.getItem("jobberAccountId");

  const [assetList, setAssetList] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [saving, setSaving] = useState(false);
  const editInputRef = useRef<HTMLInputElement>(null);

  // Delete state
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Merge state
  const [mergingId, setMergingId] = useState<string | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [mergeInProgress, setMergeInProgress] = useState(false);

  async function load() {
    if (!jobberAccountId || !clientId) return;
    const res = await fetch(
      `${API}/api/assets?clientId=${encodeURIComponent(clientId)}`
    );
    const data = (await res.json()) as { assets: Asset[] };
    setAssetList(data.assets.sort((a, b) => a.displayName.localeCompare(b.displayName)));
  }

  useEffect(() => {
    if (!jobberAccountId) { navigate("/"); return; }
    load().finally(() => setLoading(false));
  }, [clientId, jobberAccountId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (editingId && editInputRef.current) editInputRef.current.focus();
  }, [editingId]);

  function startEdit(asset: Asset) {
    setEditingId(asset.id);
    setEditName(asset.displayName);
    setMergingId(null);
  }

  async function commitEdit(assetId: string) {
    if (!jobberAccountId || !editName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`${API}/api/assets/${assetId}/rename`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: editName.trim() }),
      });
      const data = (await res.json()) as { ok: boolean; displayName?: string };
      if (data.ok) {
        await load();
      }
    } finally {
      setSaving(false);
      setEditingId(null);
    }
  }

  async function handleDelete(asset: Asset) {
    if (!jobberAccountId) return;
    if (!window.confirm(`Delete "${asset.displayName}"? This removes it from AssetMinder only. Jobs in Jobber are not affected.`)) return;
    setDeletingId(asset.id);
    try {
      await fetch(
        `${API}/api/assets/${asset.id}`,
        { method: "DELETE" }
      );
      await load();
    } finally {
      setDeletingId(null);
    }
  }

  async function handleMerge(sourceId: string) {
    if (!jobberAccountId || !mergeTargetId) return;
    const source = assetList.find((a) => a.id === sourceId)!;
    const target = assetList.find((a) => a.id === mergeTargetId)!;
    if (!window.confirm(`Merge "${source.displayName}" into "${target.displayName}"? All service history will move to the existing asset.`)) return;
    setMergeInProgress(true);
    try {
      const res = await fetch(`${API}/api/assets/${sourceId}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetAssetId: mergeTargetId }),
      });
      const data = (await res.json()) as { ok: boolean };
      if (data.ok) {
        await load();
        setMergingId(null);
        setMergeTargetId("");
      }
    } finally {
      setMergeInProgress(false);
    }
  }

  function openMerge(assetId: string) {
    setMergingId(assetId);
    setMergeTargetId("");
    setEditingId(null);
  }

  if (loading) {
    return (
      <div style={{ fontFamily: "Inter, sans-serif" }} className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-slate-400 text-sm">Loading…</p>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "Inter, sans-serif", backgroundColor: "#f8fafc" }} className="min-h-screen">
      <Nav
        left={<span className="text-white font-semibold text-lg tracking-tight">AssetMinder</span>}
        onSyncComplete={load}
      />

      <main className="max-w-3xl mx-auto px-6 py-10 space-y-6">

        <Link
          to={`/clients/${clientId}`}
          className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-600 transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to {clientName}
        </Link>

        <div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Manage assets</h1>
          <p className="text-sm text-slate-400 mt-1">{clientName} · {assetList.length} asset{assetList.length !== 1 ? "s" : ""}</p>
        </div>

        {assetList.length === 0 ? (
          <p className="text-slate-400 text-sm">No assets found for this client.</p>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
            {assetList.map((asset) => {
              const isEditing = editingId === asset.id;
              const isMerging = mergingId === asset.id;
              const isDeleting = deletingId === asset.id;
              const otherAssets = assetList.filter((a) => a.id !== asset.id);

              return (
                <div key={asset.id} className="px-5 py-4 space-y-3">
                  {/* Row */}
                  <div className="flex items-center gap-3 flex-wrap">
                    {/* Name / edit input */}
                    <div className="flex-1 min-w-0 flex items-center gap-2">
                      {isEditing ? (
                        <>
                          <input
                            ref={editInputRef}
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitEdit(asset.id);
                              if (e.key === "Escape") setEditingId(null);
                            }}
                            className="h-8 flex-1 min-w-0 rounded-md border border-slate-300 px-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400"
                          />
                          <button
                            onClick={() => commitEdit(asset.id)}
                            disabled={saving}
                            className="h-8 w-8 flex items-center justify-center rounded-md bg-slate-900 text-white hover:bg-slate-700 transition-colors disabled:opacity-50"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="h-8 w-8 flex items-center justify-center rounded-md border border-slate-200 text-slate-400 hover:bg-slate-50 transition-colors"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </>
                      ) : (
                        <>
                          <Link
                            to={`/assets/${asset.id}`}
                            state={{ clientId, clientName }}
                            className="text-sm font-semibold text-slate-800 hover:text-slate-600 transition-colors truncate"
                          >
                            {asset.displayName}
                          </Link>
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold shrink-0 ${statusPill[asset.status]}`}>
                            {statusLabel[asset.status]}
                          </span>
                          <span className="text-xs text-slate-400 shrink-0">
                            {asset.jobCount} job{asset.jobCount !== 1 ? "s" : ""}
                          </span>
                        </>
                      )}
                    </div>

                    {/* Action buttons — hidden while editing */}
                    {!isEditing && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => startEdit(asset)}
                          className="h-8 px-2.5 flex items-center gap-1 rounded-md border border-slate-200 text-slate-500 text-xs font-medium hover:bg-slate-50 transition-colors"
                        >
                          <Pencil className="h-3 w-3" />
                          Edit
                        </button>
                        <button
                          onClick={() => openMerge(asset.id)}
                          disabled={otherAssets.length === 0}
                          className="h-8 px-2.5 flex items-center gap-1 rounded-md border border-slate-200 text-slate-500 text-xs font-medium hover:bg-slate-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <GitMerge className="h-3 w-3" />
                          Merge
                        </button>
                        <button
                          onClick={() => handleDelete(asset)}
                          disabled={isDeleting}
                          className="h-8 px-2.5 flex items-center gap-1 rounded-md border border-red-200 text-red-500 text-xs font-medium hover:bg-red-50 transition-colors disabled:opacity-50"
                        >
                          <Trash2 className="h-3 w-3" />
                          {isDeleting ? "Deleting…" : "Delete"}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Merge picker — shown below the row */}
                  {isMerging && (
                    <div className="flex items-center gap-2 pl-1 flex-wrap">
                      <span className="text-xs text-slate-500">Merge into:</span>
                      <select
                        value={mergeTargetId}
                        onChange={(e) => setMergeTargetId(e.target.value)}
                        className="h-8 rounded-md border border-slate-200 bg-slate-50 px-2 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-300"
                      >
                        <option value="" disabled>Select asset…</option>
                        {otherAssets.map((a) => (
                          <option key={a.id} value={a.id}>{a.displayName}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => handleMerge(asset.id)}
                        disabled={!mergeTargetId || mergeInProgress}
                        className="h-8 px-3 rounded-md bg-slate-900 text-white text-xs font-semibold hover:bg-slate-700 transition-colors disabled:opacity-50"
                      >
                        {mergeInProgress ? "Merging…" : "Confirm merge"}
                      </button>
                      <button
                        onClick={() => { setMergingId(null); setMergeTargetId(""); }}
                        className="h-8 px-2.5 rounded-md border border-slate-200 text-slate-400 text-xs hover:bg-slate-50 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

      </main>
    </div>
  );
}
