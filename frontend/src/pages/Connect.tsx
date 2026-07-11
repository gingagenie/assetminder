import { Link } from "react-router-dom";
import { API } from "@/lib/api";

export default function Connect() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="flex flex-col items-center" style={{ gap: "24px" }}>
        <div className="flex flex-col items-center" style={{ gap: "8px" }}>
          <span
            className="text-slate-900"
            style={{ fontSize: "24px", fontWeight: 700, letterSpacing: "-0.2px" }}
          >
            AssetMinder
          </span>
          <p className="text-sm text-slate-500">Sign in to access your dashboard</p>
        </div>
        <button
          onClick={() => { window.location.href = `${API}/auth/jobber/connect`; }}
          className="w-auto h-10 bg-slate-900 hover:bg-slate-800 text-white rounded-md px-6 font-medium cursor-pointer"
        >
          Connect to Jobber
        </button>
        <Link to="/login" className="text-sm text-slate-500 hover:text-slate-700">
          Already set up? Log in
        </Link>
      </div>
    </div>
  );
}
