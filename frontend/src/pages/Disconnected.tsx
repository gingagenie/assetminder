import { Link } from "react-router-dom";
import { API } from "@/lib/api";

export default function Disconnected() {
  return (
    <div style={{ fontFamily: "Inter, sans-serif", backgroundColor: "#0f172a" }} className="min-h-screen flex flex-col">

      {/* Nav */}
      <header style={{ backgroundColor: "#1e293b", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="max-w-5xl mx-auto px-6 py-4">
          <span className="text-white font-semibold text-lg tracking-tight">AssetMinder</span>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 flex items-center justify-center px-6 py-20">
        <div className="max-w-md w-full text-center">

          {/* Icon */}
          <div
            className="mx-auto mb-8 flex items-center justify-center rounded-2xl"
            style={{ width: 72, height: 72, backgroundColor: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
          >
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ color: "#94a3b8" }}>
              <path d="M18.36 6.64A9 9 0 0 1 20.77 15" />
              <path d="M6.16 6.16a9 9 0 1 0 12.68 12.68" />
              <path d="M12 2v4" />
              <path d="m2 2 20 20" />
            </svg>
          </div>

          <h1 className="text-2xl font-bold text-white mb-3 tracking-tight">
            Account disconnected
          </h1>
          <p className="text-slate-400 text-sm leading-relaxed mb-10">
            Your AssetMinder account has been successfully disconnected from Jobber and all stored data has been permanently deleted.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <a
              href={`${API}/auth/jobber/connect`}
              className="inline-flex items-center justify-center h-11 px-6 rounded-xl bg-white text-slate-900 text-sm font-semibold hover:bg-slate-100 transition-colors shadow-sm w-full sm:w-auto"
            >
              Reconnect to Jobber
            </a>
            <Link
              to="/"
              className="inline-flex items-center justify-center h-11 px-6 rounded-xl text-slate-300 text-sm font-medium hover:text-white transition-colors border border-white/10 hover:border-white/20 w-full sm:w-auto"
            >
              Back to home
            </Link>
          </div>

        </div>
      </main>

      {/* Footer */}
      <footer style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }} className="py-6">
        <p className="text-center text-xs text-slate-600">
          AssetMinder · Built for Jobber users ·{" "}
          <Link to="/terms" className="hover:text-slate-400 transition-colors">Terms of Service</Link>
          {" · "}
          <Link to="/privacy" className="hover:text-slate-400 transition-colors">Privacy Policy</Link>
        </p>
      </footer>

    </div>
  );
}
