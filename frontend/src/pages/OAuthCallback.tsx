import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { API } from "@/lib/api";

export default function OAuthCallback() {
  const navigate = useNavigate();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    (async () => {
      try {
        // The backend handles the actual callback at /auth/jobber/callback.
        // By the time React loads this page the backend has already exchanged
        // the code — we just need to read the jobberAccountId that was embedded
        // in the redirect URL by the backend.
        // With HashRouter the query string lives inside the hash fragment e.g. /#/oauth/callback?foo=bar
        const hashSearch = window.location.hash.includes("?")
          ? window.location.hash.slice(window.location.hash.indexOf("?"))
          : "";
        const params = new URLSearchParams(hashSearch);
        const jobberAccountId = params.get("jobberAccountId");

        if (!jobberAccountId) {
          navigate("/?error=missing_account_id");
          return;
        }

        localStorage.setItem("jobberAccountId", jobberAccountId);

        // Check subscription status — expired accounts go straight to dashboard
        // which handles the SubscriptionWall. Never send them to onboarding.
        const billingRes = await fetch(`${API}/api/billing/status?jobberAccountId=${encodeURIComponent(jobberAccountId)}`);
        if (billingRes.ok) {
          const billing = (await billingRes.json()) as { subscriptionStatus: string; trialExpired: boolean };
          if (billing.trialExpired || billing.subscriptionStatus === "expired") {
            navigate("/dashboard");
            return;
          }
        }

        // Check whether field mapping is already configured
        const res = await fetch(
          `${API}/api/orgs/field-mapping?jobberAccountId=${encodeURIComponent(jobberAccountId)}`
        );
        if (!res.ok) {
          // 402 or other error — send to dashboard which handles subscription wall and auth checks
          navigate("/dashboard");
          return;
        }
        const data = (await res.json()) as { assetIdentifierField: string | null };

        if (data.assetIdentifierField) {
          navigate("/dashboard");
        } else {
          navigate("/onboarding");
        }
      } catch {
        navigate("/?error=callback_failed");
      }
    })();
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-muted-foreground">Connecting to Jobber…</p>
    </div>
  );
}
