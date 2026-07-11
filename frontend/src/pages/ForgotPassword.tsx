import { useState } from "react";
import { Link } from "react-router-dom";
import { API } from "@/lib/api";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      await fetch(`${API}/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
    } catch {
      /* Always show the same confirmation — never reveal whether the email exists. */
    } finally {
      setSent(true);
      setSubmitting(false);
    }
  }

  const inputClass =
    "w-full h-11 rounded-md border border-slate-300 px-3 focus:border-slate-900 focus:outline-none";

  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="flex flex-col" style={{ gap: "20px", width: "320px" }}>
        <div className="flex flex-col items-center" style={{ gap: "8px" }}>
          <span className="text-slate-900" style={{ fontSize: "24px", fontWeight: 700, letterSpacing: "-0.2px" }}>
            AssetMinder
          </span>
          <p className="text-sm text-slate-500">Reset your password</p>
        </div>

        {sent ? (
          <>
            <p className="text-sm text-slate-600 text-center">
              If an account exists for <span className="font-medium">{email}</span>, we've sent a
              password reset link. It expires in 1 hour.
            </p>
            <Link
              to="/login"
              className="w-full h-10 flex items-center justify-center bg-slate-900 hover:bg-slate-800 text-white rounded-md px-6 font-medium"
            >
              Back to login
            </Link>
          </>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col" style={{ gap: "20px" }}>
            <input
              type="email"
              autoComplete="username"
              autoFocus
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
            />
            <button
              type="submit"
              disabled={submitting || !email}
              className="w-full h-10 bg-slate-900 hover:bg-slate-800 text-white rounded-md px-6 font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? "Sending…" : "Send reset link"}
            </button>
            <Link to="/login" className="text-sm text-slate-500 hover:text-slate-700 text-center">
              Back to login
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
