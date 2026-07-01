import { useEffect, useState } from "react";
import { HashRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { getCachedPinSet, fetchPinSet } from "@/lib/pinStatus";
import Landing from "@/pages/Landing";
import OAuthCallback from "@/pages/OAuthCallback";
import Connect from "@/pages/Connect";
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
import Lock from "@/pages/Lock";
import SetPin from "@/pages/SetPin";
import Disconnected from "@/pages/Disconnected";
import { SubscriptionWall } from "@/components/SubscriptionWall";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const id = localStorage.getItem("jobberAccountId");
  const [pinSet, setPinSet] = useState<boolean | null>(() => (id ? getCachedPinSet(id) : null));

  useEffect(() => {
    if (!id) return;
    const cached = getCachedPinSet(id);
    if (cached !== null) { setPinSet(cached); return; }
    let cancelled = false;
    fetchPinSet(id).then((v) => { if (!cancelled) setPinSet(v); });
    return () => { cancelled = true; };
  }, [id]);

  if (!id) {
    // A locked session is remembered but not active — send to the PIN lock screen
    // rather than the public landing page.
    if (localStorage.getItem("lockedAccountId")) return <Navigate to="/lock" replace />;
    return <Navigate to="/" replace />;
  }

  // Never gate the set-pin page itself — that would loop and prevent it rendering.
  if (location.pathname === "/set-pin") return <>{children}</>;

  // Always read the live cache so a just-set PIN (setCachedPinSet called in SetPin
  // before navigate()) is visible in this render cycle, not just the next one.
  const livePin = getCachedPinSet(id);
  const effectivePin = livePin !== null ? livePin : pinSet;

  if (effectivePin === null) return null; // still waiting for API
  if (!effectivePin) return <Navigate to="/set-pin" replace state={{ next: location.pathname }} />;
  return <>{children}</>;
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
          <Route path="/connect" element={<Connect />} />
          <Route path="/lock" element={<Lock />} />
          <Route path="/set-pin" element={<RequireAuth><SetPin /></RequireAuth>} />
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
          <Route path="/disconnected" element={<Disconnected />} />
        </Routes>
      </HashRouter>
      {subscriptionRequired && <SubscriptionWall />}
    </>
  );
}
