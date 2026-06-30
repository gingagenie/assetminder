import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { API } from "@/lib/api";

export default function Lock() {
  const navigate = useNavigate();
  const lockedAccountId = localStorage.getItem("lockedAccountId");

  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  // No locked session to unlock — nothing to do here.
  useEffect(() => {
    if (!lockedAccountId) navigate("/connect", { replace: true });
  }, [lockedAccountId, navigate]);

  // Tick a clock while locked out so the countdown updates and re-enables.
  useEffect(() => {
    if (!lockedUntil) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [lockedUntil]);

  const lockedRemainingMs = lockedUntil ? lockedUntil - now : 0;
  const isLockedOut = lockedRemainingMs > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!lockedAccountId || submitting || isLockedOut) return;
    if (!/^\d{4,6}$/.test(pin)) {
      setError("Enter your 4–6 digit PIN.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/pin/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobberAccountId: lockedAccountId, pin }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        attemptsLeft?: number;
        lockedUntil?: string;
      };

      if (res.ok && data.ok) {
        localStorage.setItem("jobberAccountId", lockedAccountId);
        localStorage.removeItem("lockedAccountId");
        navigate("/dashboard", { replace: true });
        return;
      }

      setPin("");
      if (data.lockedUntil) {
        setLockedUntil(new Date(data.lockedUntil).getTime());
        setNow(Date.now());
        setError("Too many attempts. Try again shortly.");
      } else if (typeof data.attemptsLeft === "number") {
        setError(`Incorrect PIN. ${data.attemptsLeft} attempt${data.attemptsLeft === 1 ? "" : "s"} left.`);
      } else {
        setError("Incorrect PIN.");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleForgot() {
    window.location.href = `${API}/auth/jobber/connect?state=pin_reset`;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <form onSubmit={handleSubmit} className="flex flex-col items-center" style={{ gap: "24px", width: "280px" }}>
        <div className="flex flex-col items-center" style={{ gap: "8px" }}>
          <span className="text-slate-900" style={{ fontSize: "24px", fontWeight: 700, letterSpacing: "-0.2px" }}>
            AssetMinder
          </span>
          <p className="text-sm text-slate-500">Enter your PIN to unlock</p>
        </div>

        <input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          maxLength={6}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          disabled={isLockedOut || submitting}
          className="w-full h-12 text-center rounded-md border border-slate-300 focus:border-slate-900 focus:outline-none"
          style={{ fontSize: "28px", letterSpacing: "8px" }}
        />

        {error && <p className="text-sm text-destructive text-center" style={{ color: "#dc2626" }}>{error}</p>}
        {isLockedOut && (
          <p className="text-sm text-slate-500">Locked for {Math.ceil(lockedRemainingMs / 1000)}s</p>
        )}

        <button
          type="submit"
          disabled={isLockedOut || submitting || pin.length < 4}
          className="w-full h-10 bg-slate-900 hover:bg-slate-800 text-white rounded-md px-6 font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? "Unlocking…" : "Unlock"}
        </button>

        <button type="button" onClick={handleForgot} className="text-sm text-slate-500 hover:text-slate-700 cursor-pointer">
          Forgot PIN?
        </button>
      </form>
    </div>
  );
}
