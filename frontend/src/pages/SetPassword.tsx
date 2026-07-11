import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { API } from "@/lib/api";
import { setCachedAuth } from "@/lib/authStatus";

export default function SetPassword() {
  const navigate = useNavigate();
  const location = useLocation();
  const next = (location.state as { next?: string } | null)?.next ?? "/dashboard";

  const [email, setEmail] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  // The onboarding session (issued by the OAuth callback) tells us who this is.
  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/auth/session`)
      .then((r) => r.json())
      .then((s: { authenticated: boolean; email?: string; jobberAccountId?: string; passwordSet?: boolean }) => {
        if (cancelled) return;
        if (!s.authenticated) {
          navigate("/login", { replace: true });
          return;
        }
        if (s.passwordSet) {
          // Already has a password — nothing to set here.
          navigate(next, { replace: true });
          return;
        }
        if (s.jobberAccountId) localStorage.setItem("jobberAccountId", s.jobberAccountId);
        setEmail(s.email ?? null);
        setLoading(false);
      })
      .catch(() => { if (!cancelled) navigate("/login", { replace: true }); });
    return () => { cancelled = true; };
  }, [navigate, next]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API}/auth/set-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Failed to set password");
      }
      const id = localStorage.getItem("jobberAccountId") ?? undefined;
      setCachedAuth({ authenticated: true, jobberAccountId: id, passwordSet: true });
      navigate(next, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set password. Please try again.");
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <p className="text-sm text-slate-500">Loading…</p>
      </div>
    );
  }

  const inputClass =
    "w-full h-11 rounded-md border border-slate-300 px-3 focus:border-slate-900 focus:outline-none";

  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <form onSubmit={handleSubmit} className="flex flex-col" style={{ gap: "20px", width: "320px" }}>
        <div className="flex flex-col items-center" style={{ gap: "8px" }}>
          <span className="text-slate-900" style={{ fontSize: "24px", fontWeight: 700, letterSpacing: "-0.2px" }}>
            AssetMinder
          </span>
          <p className="text-sm text-slate-500 text-center">
            Set a password to log in on any device.
          </p>
        </div>

        <input
          type="email"
          autoComplete="username"
          value={email ?? ""}
          readOnly
          className={`${inputClass} bg-slate-50 text-slate-500`}
        />
        <input
          type="password"
          autoComplete="new-password"
          autoFocus
          placeholder="New password (min 8 characters)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
        />
        <input
          type="password"
          autoComplete="new-password"
          placeholder="Confirm password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className={inputClass}
        />

        {error && <p className="text-sm text-center" style={{ color: "#dc2626" }}>{error}</p>}

        <button
          type="submit"
          disabled={saving || password.length < 8 || confirm.length < 8}
          className="w-full h-10 bg-slate-900 hover:bg-slate-800 text-white rounded-md px-6 font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? "Saving…" : "Set password"}
        </button>
      </form>
    </div>
  );
}
