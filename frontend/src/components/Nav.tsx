import { useState, useEffect, useRef } from "react";
import { API } from "@/lib/api";
import { clearCachedAuth } from "@/lib/authStatus";
import { BillingModal } from "@/components/BillingModal";
import { useNavigate, useLocation } from "react-router-dom";
import { ChevronDown, RefreshCw, User } from "lucide-react";

interface NavProps {
  left?: React.ReactNode;
  right?: React.ReactNode;
  onSyncComplete?: () => void | Promise<void>;
}

export function Nav({ left, right: _right, onSyncComplete }: NavProps) {
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [billingOpen, setBillingOpen] = useState(false);
  const jobberAccountId = localStorage.getItem("jobberAccountId");
  const [unassignedCount, setUnassignedCount] = useState(0);
  const [accountName, setAccountName] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const isDashboard = location.pathname === "/dashboard";

  useEffect(() => {
    if (!jobberAccountId) return;
    fetch(`${API}/api/stats/unassigned-count`)
      .then((r) => r.ok ? r.json() : null)
      .then((data: { count: number } | null) => { if (data) setUnassignedCount(data.count); })
      .catch(() => {});
    fetch(`${API}/api/me`)
      .then((r) => r.ok ? r.json() : null)
      .then((data: { accountName: string } | null) => { if (data) setAccountName(data.accountName); })
      .catch(() => {});
  }, [jobberAccountId]);

  // Close the account menu on outside-click or Escape
  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

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

  async function handleLogout() {
    try {
      await fetch(`${API}/auth/logout`, { method: "POST" });
    } catch {
      /* clear local state regardless */
    }
    clearCachedAuth();
    localStorage.removeItem("jobberAccountId");
    localStorage.removeItem("lockedAccountId");
    navigate("/login");
  }

  async function handleSync() {
    if (!jobberAccountId) return;
    setSyncing(true);
    setSyncError(null);
    try {
      const res = await fetch(`${API}/api/sync`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setSyncError(data.error ?? "Sync failed.");
        setTimeout(() => setSyncError(null), 6000);
        return;
      }
      await new Promise((r) => setTimeout(r, 15000));
      await onSyncComplete?.();
    } catch {
      setSyncError("Sync failed.");
      setTimeout(() => setSyncError(null), 4000);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <>
      <div style={{ backgroundColor: "#0F172A", borderRadius: "8px" }}>

        {/* Top tier: brand + connection status */}
        <div
          className="flex items-center"
          style={{ padding: "14px 28px", borderBottom: "0.5px solid #1E293B" }}
        >
          <span style={{ fontSize: "24px", fontWeight: 700, color: "white", letterSpacing: "-0.2px" }}>
            AssetMinder
          </span>
          {accountName && (
            <div className="ml-auto hidden sm:flex items-center gap-2">
              <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: "#4ADE80" }} />
              <span style={{ fontSize: "12px", color: "#94A3B8" }}>
                Connected as{" "}
                <span style={{ color: "white", fontWeight: 500 }}>{accountName}</span>
              </span>
            </div>
          )}
        </div>

        {/* Bottom tier: nav links (or breadcrumb) + sync */}
        <div
          className="flex items-center justify-between"
          style={{ padding: "10px 28px", gap: "20px" }}
        >
          {isDashboard ? (
            /* Dashboard nav links */
            <div className="flex items-center" style={{ gap: "24px" }}>
              <button
                onClick={() => navigate("/dashboard")}
                style={{
                  fontSize: "13px", color: "white", fontWeight: 500,
                  paddingBottom: "6px", borderBottom: "2px solid white",
                  background: "none", borderTop: "none", borderLeft: "none", borderRight: "none",
                  cursor: "pointer",
                }}
              >
                Dashboard
              </button>
              {unassignedCount > 0 && (
                <button
                  onClick={() => navigate("/unassigned-jobs")}
                  className="hidden sm:flex items-center gap-1.5 hover:text-white transition-colors"
                  style={{ fontSize: "13px", color: "#94A3B8", background: "none", border: "none", cursor: "pointer" }}
                >
                  Unassigned
                  <span
                    className="inline-flex items-center justify-center rounded-full text-white"
                    style={{ backgroundColor: "#F59E0B", fontSize: "10px", fontWeight: 600, padding: "1px 7px" }}
                  >
                    {unassignedCount}
                  </span>
                </button>
              )}
            </div>
          ) : (
            /* Sub-page breadcrumb from left prop */
            <div className="flex items-center gap-2 min-w-0">
              {left}
            </div>
          )}

          {/* Account menu + Sync button — always right */}
          <div className="flex items-center shrink-0" style={{ gap: "16px" }}>
            {jobberAccountId && (
              <div ref={menuRef} className="relative">
                <button
                  onClick={() => setMenuOpen((o) => !o)}
                  className="flex items-center gap-2 bg-[rgba(255,255,255,0.1)] hover:bg-[rgba(255,255,255,0.15)] transition-colors"
                  style={{
                    padding: "7px 14px",
                    borderRadius: "6px",
                    border: "0.5px solid rgba(255,255,255,0.2)",
                    fontSize: "14px",
                    fontWeight: 500,
                    color: "white",
                    cursor: "pointer",
                  }}
                >
                  <User className="h-3.5 w-3.5" />
                  {accountName ?? "Account"}
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
                {menuOpen && (
                  <div
                    className="absolute right-0 mt-2 bg-white border border-slate-200 rounded-md shadow-md overflow-hidden z-50"
                    style={{ width: "180px" }}
                  >
                    <button
                      onClick={() => { setMenuOpen(false); handleLogout(); }}
                      className="flex items-center w-full h-9 px-3 text-sm text-left bg-transparent hover:bg-slate-50 cursor-pointer"
                      style={{ border: "none" }}
                    >
                      Log out
                    </button>
                    <button
                      onClick={() => { setMenuOpen(false); setBillingOpen(true); }}
                      className="flex items-center w-full h-9 px-3 text-sm text-left bg-transparent hover:bg-slate-50 cursor-pointer"
                      style={{ border: "none" }}
                    >
                      Billing
                    </button>
                    <button
                      onClick={() => { setMenuOpen(false); handleDisconnect(); }}
                      disabled={disconnecting}
                      className="flex items-center w-full h-9 px-3 text-sm text-left text-red-600 bg-transparent hover:bg-slate-50 cursor-pointer disabled:opacity-50"
                      style={{ border: "none", borderTop: "1px solid #E2E8F0" }}
                    >
                      {disconnecting ? "Disconnecting…" : "Disconnect"}
                    </button>
                  </div>
                )}
              </div>
            )}
            <button
              onClick={handleSync}
              disabled={syncing}
              className="flex items-center shrink-0 disabled:opacity-50 hover:opacity-90 transition-opacity"
              style={{
                backgroundColor: "white", color: "#0F172A",
                padding: "7px 14px", borderRadius: "6px",
                fontSize: "13px", fontWeight: 500, gap: "4px",
                border: "none", cursor: "pointer",
              }}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Syncing…" : "Sync Jobber"}
            </button>
          </div>
        </div>

      </div>

      {syncError && (
        <div className="bg-red-50 border-b border-red-200 px-6 py-2 text-center">
          <p className="text-xs text-red-600 font-medium">{syncError}</p>
        </div>
      )}
      <BillingModal open={billingOpen} onClose={() => setBillingOpen(false)} />
    </>
  );
}
