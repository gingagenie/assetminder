import { useEffect, useState } from "react";
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
import Help from "@/pages/Help";
import Admin from "@/pages/Admin";
import UnassignedJobs from "@/pages/UnassignedJobs";
import { SubscriptionWall } from "@/components/SubscriptionWall";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const id = localStorage.getItem("jobberAccountId");
  return id ? <>{children}</> : <Navigate to="/" replace />;
}

export default function App() {
  const [subscriptionRequired, setSubscriptionRequired] = useState(false);

  useEffect(() => {
    function handleSubscriptionRequired() {
      // Only show the wall if the user is logged in
      if (localStorage.getItem("jobberAccountId")) {
        setSubscriptionRequired(true);
      }
    }
    window.addEventListener("subscription_required", handleSubscriptionRequired);
    return () => window.removeEventListener("subscription_required", handleSubscriptionRequired);
  }, []);

  return (
    <>
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
          <Route path="/help" element={<Help />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/unassigned-jobs" element={<RequireAuth><UnassignedJobs /></RequireAuth>} />
        </Routes>
      </HashRouter>
      {subscriptionRequired && <SubscriptionWall />}
    </>
  );
}
