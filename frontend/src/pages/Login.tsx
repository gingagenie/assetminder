import { useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { API } from "@/lib/api";
import { setCachedAuth } from "@/lib/authStatus";

export default function Login() {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const [email, setEmail] = useState(params.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        jobberAccountId?: string;
        error?: string;
      };
      if (!res.ok || !data.ok || !data.jobberAccountId) {
        throw new Error(data.error ?? "Login failed");
      }
      localStorage.setItem("jobberAccountId", data.jobberAccountId);
      setCachedAuth({ authenticated: true, jobberAccountId: data.jobberAccountId, passwordSet: true });
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed. Please try again.");
      setSubmitting(false);
    }
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
          <p className="text-sm text-slate-500">Log in to your account</p>
        </div>

        <input
          type="email"
          autoComplete="username"
          autoFocus={!email}
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
        />
        <input
          type="password"
          autoComplete="current-password"
          autoFocus={!!email}
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
        />

        {error && <p className="text-sm text-center" style={{ color: "#dc2626" }}>{error}</p>}

        <button
          type="submit"
          disabled={submitting || !email || !password}
          className="w-full h-10 bg-slate-900 hover:bg-slate-800 text-white rounded-md px-6 font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? "Logging in…" : "Log in"}
        </button>

        <div className="flex items-center justify-between text-sm">
          <Link to="/forgot-password" className="text-slate-500 hover:text-slate-700">
            Forgot password?
          </Link>
          <Link to="/connect" className="text-slate-500 hover:text-slate-700">
            Connect with Jobber
          </Link>
        </div>
      </form>
    </div>
  );
}
