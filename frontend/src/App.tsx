import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import Landing from "@/pages/Landing";
import OAuthCallback from "@/pages/OAuthCallback";
import Onboarding from "@/pages/Onboarding";
import Dashboard from "@/pages/Dashboard";
import AssetDetail from "@/pages/AssetDetail";
import ClientDetail from "@/pages/ClientDetail";
import Portal from "@/pages/Portal";
import Terms from "@/pages/Terms";
import Privacy from "@/pages/Privacy";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const id = localStorage.getItem("jobberAccountId");
  return id ? <>{children}</> : <Navigate to="/" replace />;
}

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/oauth/callback" element={<OAuthCallback />} />
        <Route path="/onboarding" element={<RequireAuth><Onboarding /></RequireAuth>} />
        <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
        <Route path="/clients/:clientId" element={<RequireAuth><ClientDetail /></RequireAuth>} />
        <Route path="/assets/:assetId" element={<RequireAuth><AssetDetail /></RequireAuth>} />
        <Route path="/portal/:token" element={<Portal />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/privacy" element={<Privacy />} />
      </Routes>
    </HashRouter>
  );
}
