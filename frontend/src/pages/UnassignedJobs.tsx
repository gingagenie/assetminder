import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { API } from "@/lib/api";
import { ChevronLeft, ChevronDown, ChevronRight } from "lucide-react";
import { Nav } from "@/components/Nav";

// ---------- Types ----------

interface UnassignedJob {
  id: string;
  jobberJobId: string;
  jobNumber: number | null;
  title: string | null;
  instructions: string | null;
  startDate: string | null;
  completedAt: string | null;
  status: string;
}

interface ClientGroup {
  clientId: string | null;
  clientName: string | null;
  jobs: UnassignedJob[];
}

// ---------- Helpers ----------

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
}

function jobStatusPill(status: string): string {
  const s = status.toLowerCase();
  if (s === "completed")          return "bg-green-100 text-green-700";
  if (s === "active")             return "bg-blue-100 text-blue-700";
  if (s === "requires_invoicing") return "bg-amber-100 text-amber-700";
  return "bg-slate-100 text-slate-500";
}

function jobStatusLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const NO_CLIENT_KEY = "__no_client__";

function collapseKey(g: ClientGroup): string {
  return g.clientId ?? NO_CLIENT_KEY;
}

// ---------- ClientSection ----------

interface ClientSectionProps {
  group: ClientGroup;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  selectedIds: Set<string>;
  onToggleJob: (id: string) => void;
  onSelectAll: (jobs: UnassignedJob[], checked: boolean) => void;
}

function ClientSection({
  group,
  isCollapsed,
  onToggleCollapse,
  selectedIds,
  onToggleJob,
  onSelectAll,
}: ClientSectionProps) {
  const allSelected  = group.jobs.length > 0 && group.jobs.every((j) => selectedIds.has(j.id));
  const someSelected = group.jobs.some((j) => selectedIds.has(j.id));
  const headerCheckRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (headerCheckRef.current) {
      headerCheckRef.current.indeterminate = someSelected && !allSelected;
    }
  }, [someSelected, allSelected]);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">

      {/* Section header */}
      <div className="flex items-center gap-3 px-5 py-3 bg-slate-50 border-b border-slate-100">
        <input
          ref={headerCheckRef}
          type="checkbox"
          checked={allSelected}
          onChange={(e) => onSelectAll(group.jobs, e.target.checked)}
          onClick={(e) => e.stopPropagation()}
          className="h-4 w-4 rounded border-slate-300 accent-slate-700 cursor-pointer shrink-0"
        />
        <button
          onClick={onToggleCollapse}
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
        >
          {isCollapsed
            ? <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />
            : <ChevronDown  className="h-4 w-4 text-slate-400 shrink-0" />
          }
          <span className="text-sm font-semibold text-slate-700 truncate">
            {group.clientName ?? "No client"}
          </span>
          <span className="text-xs text-slate-400 shrink-0 ml-1">
            {group.jobs.length} job{group.jobs.length !== 1 ? "s" : ""}
          </span>
        </button>
      </div>

      {/* Job rows */}
      {!isCollapsed && (
        <div className="divide-y divide-slate-100">
          {group.jobs.map((job) => (
            <label
              key={job.id}
              className="flex items-start gap-3 px-5 py-3.5 hover:bg-slate-50 transition-colors cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selectedIds.has(job.id)}
                onChange={() => onToggleJob(job.id)}
                className="h-4 w-4 mt-0.5 rounded border-slate-300 accent-slate-700 cursor-pointer shrink-0"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {job.jobNumber != null && (
                    <span className="text-xs font-mono text-slate-400 shrink-0">
                      #{job.jobNumber}
                    </span>
                  )}
                  <span className="text-sm font-medium text-slate-800 truncate">
                    {job.title ?? "(No title)"}
                  </span>
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium shrink-0 ${jobStatusPill(job.status)}`}>
                    {jobStatusLabel(job.status)}
                  </span>
                </div>
                {job.instructions && (
                  <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">
                    {job.instructions.slice(0, 100)}
                  </p>
                )}
                <p className="text-xs text-slate-400 mt-0.5">
                  {formatDate(job.startDate)}
                </p>
              </div>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- UnassignedJobs ----------

export default function UnassignedJobs() {
  const navigate = useNavigate();
  const jobberAccountId = localStorage.getItem("jobberAccountId") ?? "";

  const [groups, setGroups]       = useState<ClientGroup[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [search, setSearch]       = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Accumulates jobId → clientId for every job ever loaded so the
  // multi-client check works even when a job is hidden by search.
  const jobClientMapRef = useRef<Map<string, string | null>>(new Map());

  // Tracks whether we've set the initial collapsed state.
  const initializedRef = useRef(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function fetchJobs(q: string) {
    if (!jobberAccountId) return;
    setLoading(true);
    setError(null);
    try {
      const url = new URL(`${API || window.location.origin}/api/jobs/unassigned`);
      url.searchParams.set("jobberAccountId", jobberAccountId);
      if (q.trim()) url.searchParams.set("search", q.trim());
      const res = await fetch(url.toString());
      if (!res.ok) { setError("Failed to load unassigned jobs."); return; }
      const data = (await res.json()) as { clients: ClientGroup[] };

      // Accumulate into the persistent map
      for (const g of data.clients) {
        for (const j of g.jobs) {
          jobClientMapRef.current.set(j.id, g.clientId);
        }
      }

      setGroups(data.clients);

      // Set initial collapsed state exactly once, on first successful load
      if (!initializedRef.current) {
        initializedRef.current = true;
        const realClients = data.clients.filter((g) => g.clientId !== null);
        const next = new Set<string>();
        if (realClients.length >= 3) {
          realClients.forEach((g) => next.add(g.clientId!));
        }
        // "No client" always starts collapsed
        data.clients.filter((g) => g.clientId === null).forEach(() => {
          next.add(NO_CLIENT_KEY);
        });
        setCollapsed(next);
      }
    } catch {
      setError("Failed to load unassigned jobs.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!jobberAccountId) { navigate("/"); return; }
    fetchJobs("");
  }, [jobberAccountId, navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSearchChange(value: string) {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchJobs(value), 300);
  }

  function toggleCollapse(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function toggleJob(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function selectAll(jobs: UnassignedJob[], checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      jobs.forEach((j) => (checked ? next.add(j.id) : next.delete(j.id)));
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  // Derive the unique set of client IDs for selected jobs
  const selectedClientIds = new Set<string | null>();
  for (const id of selectedIds) {
    if (jobClientMapRef.current.has(id)) {
      selectedClientIds.add(jobClientMapRef.current.get(id) ?? null);
    }
  }
  const selectedCount = selectedIds.size;
  const multiClient   = selectedClientIds.size > 1;
  const disabledTitle = multiClient
    ? `Assets belong to a single client. Selected jobs span ${selectedClientIds.size} clients.`
    : undefined;

  // "No client" group always last
  const sortedGroups = [
    ...groups.filter((g) => g.clientId !== null),
    ...groups.filter((g) => g.clientId === null),
  ];

  const totalJobs = groups.reduce((sum, g) => sum + g.jobs.length, 0);

  if (loading && groups.length === 0) {
    return (
      <div style={{ fontFamily: "Inter, sans-serif" }} className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-slate-400 text-sm">Loading…</p>
      </div>
    );
  }

  if (error && groups.length === 0) {
    return (
      <div style={{ fontFamily: "Inter, sans-serif" }} className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-red-500 text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "Inter, sans-serif", backgroundColor: "#f8fafc" }} className="min-h-screen pb-24">

      <Nav
        left={
          <>
            <button
              onClick={() => navigate("/dashboard")}
              className="flex items-center gap-1 text-slate-400 hover:text-white transition-colors shrink-0"
            >
              <ChevronLeft className="h-4 w-4" />
              <span className="text-sm">Dashboard</span>
            </button>
            <span className="text-slate-600 text-sm">/</span>
            <span className="text-white font-semibold text-sm">Unassigned jobs</span>
          </>
        }
      />

      <main className="max-w-3xl mx-auto px-6 py-10">

        <div className="flex items-baseline gap-2 mb-6">
          <h1 className="text-lg font-semibold text-slate-800">Unassigned jobs</h1>
          {!loading && (
            <span className="text-sm text-slate-400">{totalJobs}</span>
          )}
          {loading && groups.length > 0 && (
            <span className="text-xs text-slate-400">Searching…</span>
          )}
        </div>

        {/* Search */}
        <input
          type="text"
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Search by title or instructions…"
          className="w-full px-4 py-2.5 mb-6 rounded-lg border border-slate-200 bg-white text-sm text-slate-800 placeholder-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
        />

        {/* Groups */}
        {sortedGroups.length === 0 ? (
          <p className="text-slate-400 text-sm">
            {search.trim()
              ? "No unassigned jobs match your search."
              : "All jobs are assigned to assets — nothing to group."}
          </p>
        ) : (
          <div className="space-y-4">
            {sortedGroups.map((group) => (
              <ClientSection
                key={collapseKey(group)}
                group={group}
                isCollapsed={collapsed.has(collapseKey(group))}
                onToggleCollapse={() => toggleCollapse(collapseKey(group))}
                selectedIds={selectedIds}
                onToggleJob={toggleJob}
                onSelectAll={selectAll}
              />
            ))}
          </div>
        )}

      </main>

      {/* Sticky action bar */}
      {selectedCount > 0 && (
        <div
          style={{ fontFamily: "Inter, sans-serif" }}
          className="fixed bottom-0 inset-x-0 z-10 bg-white border-t border-slate-200 shadow-lg"
        >
          <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-sm font-semibold text-slate-700">
                {selectedCount} job{selectedCount !== 1 ? "s" : ""} selected
              </span>
              <button
                onClick={clearSelection}
                className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
              >
                Clear
              </button>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                disabled={multiClient}
                title={disabledTitle}
                onClick={() => {
                  console.log("Create new asset", {
                    selectedJobIds: [...selectedIds],
                    clientIds: [...selectedClientIds],
                  });
                }}
                className="text-sm font-semibold px-4 py-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Create new asset
              </button>
              <button
                disabled={multiClient}
                title={disabledTitle}
                onClick={() => {
                  console.log("Add to existing asset", {
                    selectedJobIds: [...selectedIds],
                    clientIds: [...selectedClientIds],
                  });
                }}
                className="text-sm font-semibold px-4 py-2 rounded-lg bg-slate-800 text-white hover:bg-slate-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Add to existing asset
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
