import { useEffect, useState } from "react";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { getCachedAuth, fetchAuth } from "@/lib/authStatus";
import Landing from "@/pages/Landing";
import OAuthCallback from "@/pages/OAuthCallback";
import Connect from "@/pages/Connect";
import Login from "@/pages/Login";
import SetPassword from "@/pages/SetPassword";
import ForgotPassword from "@/pages/ForgotPassword";
import ResetPassword from "@/pages/ResetPassword";
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
import Disconnected from "@/pages/Disconnected";
import ClientAssets from "@/pages/ClientAssets";
import { SubscriptionWall } from "@/components/SubscriptionWall";

type Gate = "loading" | "authed" | "nopassword" | "anon";

function gateFromAuth(a: ReturnType<typeof getCachedAuth>): Gate {
  if (!a) return "loading";
  if (!a.authenticated || !a.jobberAccountId) return "anon";
  return a.passwordSet ? "authed" : "nopassword";
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const [gate, setGate] = useState<Gate>(() => gateFromAuth(getCachedAuth()));

  useEffect(() => {
    let cancelled = false;
    fetchAuth().then((a) => {
      if (cancelled) return;
      if (a.authenticated && a.jobberAccountId) {
        localStorage.setItem("jobberAccountId", a.jobberAccountId);
      } else {
        localStorage.removeItem("jobberAccountId");
      }
      setGate(gateFromAuth(a));
    });
    return () => { cancelled = true; };
  }, []);

  if (gate === "loading") return null;
  if (gate === "anon") return <Navigate to="/login" replace />;
  // An onboarding session exists but no password set yet — finish onboarding.
  if (gate === "nopassword") return <Navigate to="/set-password" replace />;
  return <>{children}</>;
}

export default function App() {
  const [subscriptionRequired, setSubscriptionRequired] = useState(false);

  useEffect(() => {
    function handleSubscriptionRequired() {
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
          <Route path="/login" element={<Login />} />
          <Route path="/set-password" element={<SetPassword />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset" element={<ResetPassword />} />
          <Route path="/onboarding" element={<RequireAuth><Onboarding /></RequireAuth>} />
          <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
          <Route path="/clients/:clientId" element={<RequireAuth><ClientDetail /></RequireAuth>} />
          <Route path="/clients/:clientId/assets" element={<RequireAuth><ClientAssets /></RequireAuth>} />
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
