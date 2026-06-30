import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { API } from "@/lib/api";
import { setCachedPinSet } from "@/lib/pinStatus";

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
        const isReset = params.get("reset") === "1";

        if (!jobberAccountId) {
          navigate("/?error=missing_account_id");
          return;
        }

        localStorage.setItem("jobberAccountId", jobberAccountId);
        // A fresh authentication supersedes any locked session.
        localStorage.removeItem("lockedAccountId");

        // Work out where the user should ultimately land.
        let destination = "/dashboard";

        // Check subscription status — expired accounts go straight to dashboard
        // which handles the SubscriptionWall. Never send them to onboarding.
        const billingRes = await fetch(`${API}/api/billing/status?jobberAccountId=${encodeURIComponent(jobberAccountId)}`);
        let trialExpired = false;
        if (billingRes.ok) {
          const billing = (await billingRes.json()) as { subscriptionStatus: string; trialExpired: boolean };
          trialExpired = billing.trialExpired || billing.subscriptionStatus === "expired";
        }

        if (!trialExpired) {
          // Check whether field mapping is already configured
          const res = await fetch(
            `${API}/api/orgs/field-mapping?jobberAccountId=${encodeURIComponent(jobberAccountId)}`
          );
          if (res.ok) {
            const data = (await res.json()) as { assetIdentifierField: string | null };
            destination = data.assetIdentifierField ? "/dashboard" : "/onboarding";
          }
          // non-ok (402/etc) falls through to /dashboard which handles the wall
        }

        // First connect (no PIN yet) or a Forgot-PIN reset must set a PIN first.
        const pinRes = await fetch(`${API}/api/pin/status?jobberAccountId=${encodeURIComponent(jobberAccountId)}`);
        const pinSet = pinRes.ok ? ((await pinRes.json()) as { pinSet: boolean }).pinSet : true;
        setCachedPinSet(jobberAccountId, pinSet);

        if (isReset || !pinSet) {
          navigate("/set-pin", { replace: true, state: { next: destination } });
        } else {
          navigate(destination);
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
