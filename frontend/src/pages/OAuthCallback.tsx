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
        // The backend has already exchanged the code and, for a first-time
        // (no-password) connect, issued the onboarding session cookie. Ask who
        // we are rather than trusting anything in the URL.
        const sess = (await (await fetch(`${API}/auth/session`)).json()) as {
          authenticated: boolean;
          jobberAccountId?: string;
          passwordSet?: boolean;
        };

        if (!sess.authenticated || !sess.jobberAccountId) {
          // No onboarding session — the account already has a password and must
          // log in (the backend redirects there directly; this is a fallback).
          navigate("/login", { replace: true });
          return;
        }

        const jobberAccountId = sess.jobberAccountId;
        localStorage.setItem("jobberAccountId", jobberAccountId);
        localStorage.removeItem("lockedAccountId");

        // Work out the eventual destination: expired trials go to the dashboard
        // (which shows the SubscriptionWall); otherwise onboarding vs dashboard
        // depends on whether the asset field mapping is configured.
        let destination = "/dashboard";
        const billingRes = await fetch(
          `${API}/api/billing/status?jobberAccountId=${encodeURIComponent(jobberAccountId)}`
        );
        let trialExpired = false;
        if (billingRes.ok) {
          const billing = (await billingRes.json()) as { subscriptionStatus: string; trialExpired: boolean };
          trialExpired = billing.trialExpired || billing.subscriptionStatus === "expired";
        }
        if (!trialExpired) {
          const res = await fetch(
            `${API}/api/orgs/field-mapping?jobberAccountId=${encodeURIComponent(jobberAccountId)}`
          );
          if (res.ok) {
            const data = (await res.json()) as { assetIdentifierField: string | null };
            destination = data.assetIdentifierField ? "/dashboard" : "/onboarding";
          }
        }

        // First-time connect: set a password before continuing.
        if (!sess.passwordSet) {
          navigate("/set-password", { replace: true, state: { next: destination } });
        } else {
          navigate(destination, { replace: true });
        }
      } catch {
        navigate("/login?error=callback_failed", { replace: true });
      }
    })();
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-muted-foreground">Connecting to Jobber…</p>
    </div>
  );
}
