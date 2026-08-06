import { useEffect, useRef, useState } from "react";
import { API } from "@/lib/api";

const ALLOWED_TAGS = ["follow up", "suspicious", "VIP", "needs reconnect"] as const;
type OrgTag = typeof ALLOWED_TAGS[number];

const TAG_STYLES: Record<OrgTag, string> = {
  "follow up":      "bg-blue-900/60 text-blue-300 border-blue-700/50",
  "suspicious":     "bg-red-900/60 text-red-300 border-red-700/50",
  "VIP":            "bg-yellow-900/60 text-yellow-300 border-yellow-700/50",
  "needs reconnect":"bg-orange-900/60 text-orange-300 border-orange-700/50",
};
const TAG_ACTIVE_STYLES: Record<OrgTag, string> = {
  "follow up":      "bg-blue-700/80 text-blue-200 border-blue-500",
  "suspicious":     "bg-red-700/80 text-red-200 border-red-500",
  "VIP":            "bg-yellow-700/80 text-yellow-200 border-yellow-500",
  "needs reconnect":"bg-orange-700/80 text-orange-200 border-orange-500",
};

interface TimelineEvent {
  id: string;
  eventType: string;
  metadata: string | null;
  createdAt: string;
}

interface Note {
  id: string;
  body: string;
  createdAt: string;
}

interface OrgDetail {
  id: string;
  jobberAccountId: string;
  displayName: string | null;
  email: string | null;
  createdAt: string;
  trialStartedAt: string | null;
  trialEndsAt: string;
  subscriptionStatus: string;
  disconnectedAt: string | null;
  expiresAt: string;
  updatedAt: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  assetIdentifierField: string | null;
  tags: string[];
  activity: { assetCount: number; clientCount: number; jobCount: number; lastLoginAt: string | null };
  timeline: TimelineEvent[];
  notes: Note[];
}

interface Props {
  orgId: string;
  adminKey: string;
  onClose: () => void;
  onRefreshTable: () => void;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function fmtRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function describeEvent(eventType: string, metadata: string | null): string {
  const m = metadata ? JSON.parse(metadata) as Record<string, unknown> : null;
  switch (eventType) {
    case "oauth_login":      return "OAuth login";
    case "disconnect":       return "Disconnected";
    case "reconnect":        return "Reconnected";
    case "sync_completed":
      return m ? `Sync — ${m.clientsUpserted} clients, ${m.jobsUpserted} jobs` : "Sync completed";
    case "asset_created":
      return m?.identifier ? `Asset created — ${m.identifier}` : "Asset created";
    case "asset_updated":
      if (m?.action === "renamed") return `Asset renamed — "${m.from}" → "${m.to}"`;
      if (m?.action === "merged") return `Asset merged — "${m.identifier}" into "${m.into}"`;
      return "Asset updated";
    case "portal_shared":
      return m?.clientName ? `Portal shared — ${m.clientName}` : "Portal link generated";
    default:
      return eventType;
  }
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-3">{children}</h3>;
}

function DataRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <span className="w-32 flex-shrink-0 text-xs text-slate-500">{label}</span>
      <span className="text-sm text-slate-200 min-w-0 break-all">{children}</span>
    </div>
  );
}

export default function OrgDetailPanel({ orgId, adminKey, onClose, onRefreshTable }: Props) {
  const [detail, setDetail] = useState<OrgDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noteBody, setNoteBody] = useState("");
  const [notePending, setNotePending] = useState(false);
  const [tagPending, setTagPending] = useState(false);
  const [refreshPending, setRefreshPending] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  function apiUrl(path: string) {
    return `${API}/api/admin/orgs/${orgId}/${path}?key=${encodeURIComponent(adminKey)}`;
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/admin/orgs/${orgId}?key=${encodeURIComponent(adminKey)}`);
      if (!res.ok) { setError("Failed to load org detail."); return; }
      setDetail(await res.json() as OrgDetail);
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [orgId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function toggleTag(tag: OrgTag) {
    if (!detail || tagPending) return;
    const current = detail.tags as string[];
    const next = current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag];
    setTagPending(true);
    setDetail({ ...detail, tags: next });
    try {
      await fetch(apiUrl("tags"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: next }),
      });
    } finally {
      setTagPending(false);
    }
  }

  async function addNote() {
    if (!noteBody.trim() || notePending) return;
    setNotePending(true);
    try {
      const res = await fetch(apiUrl("notes"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: noteBody.trim() }),
      });
      if (res.ok) {
        setNoteBody("");
        await load();
      }
    } finally {
      setNotePending(false);
    }
  }

  async function deleteNote(noteId: string) {
    await fetch(`${API}/api/admin/orgs/${orgId}/notes/${noteId}?key=${encodeURIComponent(adminKey)}`, { method: "DELETE" });
    await load();
  }

  async function forceRefresh() {
    if (refreshPending) return;
    setRefreshPending(true);
    setRefreshMsg(null);
    try {
      const res = await fetch(apiUrl("force-refresh-token"), { method: "POST" });
      if (res.ok) {
        setRefreshMsg("Token refreshed.");
        await load();
        onRefreshTable();
      } else {
        const data = await res.json() as { error?: string };
        setRefreshMsg(data.error ?? "Refresh failed.");
      }
    } catch {
      setRefreshMsg("Network error.");
    } finally {
      setRefreshPending(false);
    }
  }

  const STATUS_STYLES: Record<string, string> = {
    active:  "bg-green-100 text-green-700",
    trial:   "bg-blue-100 text-blue-700",
    expired: "bg-red-100 text-red-700",
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-full max-w-xl bg-slate-900 border-l border-slate-800 z-50 flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-start justify-between px-6 py-5 border-b border-slate-800 flex-shrink-0">
          <div>
            {loading ? (
              <p className="text-slate-400 text-sm">Loading…</p>
            ) : detail ? (
              <>
                <p className="text-white font-semibold text-lg leading-tight truncate max-w-xs">
                  {detail.displayName ?? "—"}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_STYLES[detail.subscriptionStatus] ?? "bg-slate-700 text-slate-300"}`}>
                    {detail.subscriptionStatus}
                  </span>
                  {detail.disconnectedAt && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-400">disconnected</span>
                  )}
                </div>
              </>
            ) : (
              <p className="text-red-400 text-sm">{error}</p>
            )}
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors text-xl leading-none mt-0.5">×</button>
        </div>

        {detail && (
          <div className="overflow-y-auto flex-1 px-6 py-5 space-y-7">

            {/* Tags */}
            <div>
              <SectionHeading>Tags</SectionHeading>
              <div className="flex flex-wrap gap-2">
                {ALLOWED_TAGS.map((tag) => {
                  const active = detail.tags.includes(tag);
                  return (
                    <button
                      key={tag}
                      onClick={() => toggleTag(tag)}
                      disabled={tagPending}
                      className={`text-xs font-medium px-3 py-1 rounded-full border transition-colors disabled:opacity-60 ${active ? TAG_ACTIVE_STYLES[tag] : TAG_STYLES[tag]}`}
                    >
                      {active ? "✓ " : ""}{tag}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Profile */}
            <div>
              <SectionHeading>Profile</SectionHeading>
              <div className="space-y-0.5">
                <DataRow label="Name">{detail.displayName ?? <span className="text-slate-600">—</span>}</DataRow>
                <DataRow label="Email">{detail.email ?? <span className="text-slate-600">—</span>}</DataRow>
                <DataRow label="Internal ID">
                  <span className="font-mono text-xs text-slate-400 select-all">{detail.id}</span>
                </DataRow>
                <DataRow label="Jobber ID">
                  <span className="font-mono text-xs">{detail.jobberAccountId}</span>
                </DataRow>
                <DataRow label="Joined">{fmtDate(detail.createdAt)}</DataRow>
                <DataRow label="Trial started">{detail.trialStartedAt ? fmtDate(detail.trialStartedAt) : <span className="text-slate-600">—</span>}</DataRow>
                <DataRow label="Trial ends">{fmtDate(detail.trialEndsAt)}</DataRow>
                <DataRow label="Asset field">{detail.assetIdentifierField ?? <span className="text-slate-600">—</span>}</DataRow>
              </div>
            </div>

            {/* Jobber Connection */}
            <div>
              <SectionHeading>Jobber Connection</SectionHeading>
              <div className="space-y-0.5">
                <DataRow label="Status">
                  {detail.disconnectedAt
                    ? <span className="text-orange-400">Disconnected {fmtDate(detail.disconnectedAt)}</span>
                    : <span className="text-green-400">Connected</span>
                  }
                </DataRow>
                <DataRow label="Token expires">
                  <span className={new Date(detail.expiresAt).getTime() < Date.now() + 24 * 3600 * 1000 ? "text-yellow-400" : ""}>
                    {fmtDateTime(detail.expiresAt)}
                  </span>
                </DataRow>
              </div>
              {!detail.disconnectedAt && (
                <div className="mt-3 flex items-center gap-3">
                  <button
                    onClick={forceRefresh}
                    disabled={refreshPending}
                    className="text-xs px-3 py-1.5 rounded-md bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors disabled:opacity-50"
                  >
                    {refreshPending ? "Refreshing…" : "Force refresh token"}
                  </button>
                  {refreshMsg && (
                    <span className={`text-xs ${refreshMsg === "Token refreshed." ? "text-green-400" : "text-red-400"}`}>
                      {refreshMsg}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Billing */}
            <div>
              <SectionHeading>Billing</SectionHeading>
              <div className="space-y-0.5">
                <DataRow label="Stripe customer">
                  {detail.stripeCustomerId ? (
                    <a
                      href={`https://dashboard.stripe.com/customers/${detail.stripeCustomerId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-xs text-indigo-400 hover:text-indigo-300 underline"
                    >
                      {detail.stripeCustomerId}
                    </a>
                  ) : <span className="text-slate-600">—</span>}
                </DataRow>
                <DataRow label="Stripe sub">
                  {detail.stripeSubscriptionId ? (
                    <a
                      href={`https://dashboard.stripe.com/subscriptions/${detail.stripeSubscriptionId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-xs text-indigo-400 hover:text-indigo-300 underline"
                    >
                      {detail.stripeSubscriptionId}
                    </a>
                  ) : <span className="text-slate-600">—</span>}
                </DataRow>
              </div>
            </div>

            {/* Activity */}
            <div>
              <SectionHeading>Activity</SectionHeading>
              <div className="grid grid-cols-3 gap-3 mb-2">
                {[
                  { label: "Assets", value: detail.activity.assetCount },
                  { label: "Clients", value: detail.activity.clientCount },
                  { label: "Jobs", value: detail.activity.jobCount },
                ].map((s) => (
                  <div key={s.label} className="bg-slate-800/60 rounded-lg border border-slate-700/50 px-4 py-3 text-center">
                    <p className="text-xs text-slate-500 mb-1">{s.label}</p>
                    <p className="text-xl font-bold text-white">{s.value}</p>
                  </div>
                ))}
              </div>
              <DataRow label="Last login">
                {detail.activity.lastLoginAt
                  ? <span title={fmtDateTime(detail.activity.lastLoginAt)}>{fmtRelative(detail.activity.lastLoginAt)}</span>
                  : <span className="text-slate-600">—</span>
                }
              </DataRow>
            </div>

            {/* Timeline */}
            <div>
              <SectionHeading>Timeline</SectionHeading>
              {detail.timeline.length === 0 ? (
                <p className="text-xs text-slate-600">No events recorded.</p>
              ) : (
                <div className="space-y-0 relative">
                  <div className="absolute left-2 top-2 bottom-2 w-px bg-slate-800" />
                  {detail.timeline.map((ev) => (
                    <div key={ev.id} className="flex items-start gap-4 py-2">
                      <span className="w-4 h-4 rounded-full bg-slate-700 border border-slate-600 flex-shrink-0 mt-0.5 relative z-10" />
                      <div className="min-w-0">
                        <p className="text-sm text-slate-300">{describeEvent(ev.eventType, ev.metadata)}</p>
                        <p className="text-xs text-slate-600">{fmtDateTime(ev.createdAt)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Notes */}
            <div>
              <SectionHeading>Notes</SectionHeading>
              <div className="flex gap-2 mb-4">
                <textarea
                  ref={noteRef}
                  value={noteBody}
                  onChange={(e) => setNoteBody(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) addNote(); }}
                  placeholder="Add a note… (⌘+Enter to save)"
                  rows={2}
                  className="flex-1 text-sm bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-slate-500 resize-none"
                />
                <button
                  onClick={addNote}
                  disabled={notePending || !noteBody.trim()}
                  className="text-xs px-3 py-1.5 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors disabled:opacity-40 self-start mt-0.5"
                >
                  Add
                </button>
              </div>
              {detail.notes.length === 0 ? (
                <p className="text-xs text-slate-600">No notes yet.</p>
              ) : (
                <div className="space-y-2">
                  {detail.notes.map((note) => (
                    <div key={note.id} className="bg-slate-800/50 rounded-lg border border-slate-700/50 px-4 py-3 group relative">
                      <p className="text-sm text-slate-200 whitespace-pre-wrap">{note.body}</p>
                      <p className="text-xs text-slate-600 mt-1">{fmtDateTime(note.createdAt)}</p>
                      <button
                        onClick={() => deleteNote(note.id)}
                        className="absolute top-2 right-2 text-xs text-slate-700 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        )}

      </div>
    </>
  );
}
