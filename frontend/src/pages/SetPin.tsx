import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { API } from "@/lib/api";
import { setCachedPinSet } from "@/lib/pinStatus";

export default function SetPin() {
  const navigate = useNavigate();
  const location = useLocation();
  const jobberAccountId = localStorage.getItem("jobberAccountId");
  const next = (location.state as { next?: string } | null)?.next ?? "/dashboard";

  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!jobberAccountId || saving) return;
    if (!/^\d{4,6}$/.test(pin)) {
      setError("PIN must be 4–6 digits.");
      return;
    }
    if (pin !== confirm) {
      setError("PINs don't match.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/pin/set`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobberAccountId, pin }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Failed to set PIN");
      }
      setCachedPinSet(jobberAccountId, true);
      navigate(next, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set PIN. Please try again.");
      setSaving(false);
    }
  }

  const inputClass =
    "w-full h-12 text-center rounded-md border border-slate-300 focus:border-slate-900 focus:outline-none";
  const inputStyle = { fontSize: "28px", letterSpacing: "8px" } as const;

  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <form onSubmit={handleSubmit} className="flex flex-col items-center" style={{ gap: "24px", width: "280px" }}>
        <div className="flex flex-col items-center" style={{ gap: "8px" }}>
          <span className="text-slate-900" style={{ fontSize: "24px", fontWeight: 700, letterSpacing: "-0.2px" }}>
            AssetMinder
          </span>
          <p className="text-sm text-slate-500 text-center">
            Set a 4–6 digit PIN to lock this device when you log out.
          </p>
        </div>

        <input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          maxLength={6}
          placeholder="PIN"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          className={inputClass}
          style={inputStyle}
        />
        <input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={6}
          placeholder="Confirm"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ""))}
          className={inputClass}
          style={inputStyle}
        />

        {error && <p className="text-sm text-center" style={{ color: "#dc2626" }}>{error}</p>}

        <button
          type="submit"
          disabled={saving || pin.length < 4 || confirm.length < 4}
          className="w-full h-10 bg-slate-900 hover:bg-slate-800 text-white rounded-md px-6 font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? "Saving…" : "Set PIN"}
        </button>
      </form>
    </div>
  );
}
