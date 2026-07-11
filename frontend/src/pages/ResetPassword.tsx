import { useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { API } from "@/lib/api";
import { setCachedAuth } from "@/lib/authStatus";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
      const res = await fetch(`${API}/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        jobberAccountId?: string;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "Failed to reset password");
      }
      if (data.jobberAccountId) {
        localStorage.setItem("jobberAccountId", data.jobberAccountId);
        setCachedAuth({ authenticated: true, jobberAccountId: data.jobberAccountId, passwordSet: true });
      }
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset password. Please try again.");
      setSaving(false);
    }
  }

  const inputClass =
    "w-full h-11 rounded-md border border-slate-300 px-3 focus:border-slate-900 focus:outline-none";

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="flex flex-col items-center" style={{ gap: "16px", width: "320px" }}>
          <p className="text-sm text-slate-600 text-center">This reset link is invalid or incomplete.</p>
          <Link to="/forgot-password" className="text-sm text-slate-500 hover:text-slate-700">
            Request a new reset link
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <form onSubmit={handleSubmit} className="flex flex-col" style={{ gap: "20px", width: "320px" }}>
        <div className="flex flex-col items-center" style={{ gap: "8px" }}>
          <span className="text-slate-900" style={{ fontSize: "24px", fontWeight: 700, letterSpacing: "-0.2px" }}>
            AssetMinder
          </span>
          <p className="text-sm text-slate-500">Choose a new password</p>
        </div>

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
          {saving ? "Saving…" : "Reset password"}
        </button>
      </form>
    </div>
  );
}
