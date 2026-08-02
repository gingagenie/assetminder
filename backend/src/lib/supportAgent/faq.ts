export const FAQ_CONTENT = `
# MinderApps Help Guide

## What is AssetMinder?
AssetMinder connects to your Jobber account to automatically track the equipment and assets you service for clients. It reads your completed Jobber jobs, identifies assets (based on a configurable field like serial number or equipment ID), builds a full service history per asset, and alerts you when assets are coming due for service.

## What is ContractMinder?
ContractMinder is a companion app for managing recurring service contracts for Jobber users. If you have questions about ContractMinder, email us and we'll help.

## Connecting Jobber to AssetMinder
1. Log in to AssetMinder (or create a password in Settings if first time).
2. Click "Connect Jobber" on the dashboard.
3. You'll be redirected to Jobber's OAuth authorization page — log in to Jobber if prompted, then click "Authorize".
4. You'll return to AssetMinder, now connected. Click "Sync Now" to import your job history.

If your connection breaks: go to Account Settings → click "Disconnect Jobber" → then reconnect using the steps above.

## Syncing Assets / Sync Now
After connecting Jobber, click "Sync Now" on the dashboard to pull in your job history and build your asset list. Syncing reads your completed jobs from Jobber and extracts asset identifiers. The first sync may take a minute or two. Subsequent syncs only pull new data.

## Setting the Asset Identifier Field
AssetMinder needs to know which Jobber field holds your asset identifier (e.g., a custom field for serial number or equipment tag). Go to Settings → Asset Identifier, then select the Jobber custom field you use to track assets. You must have this field on your Jobber jobs for AssetMinder to detect assets.

## Service Intervals / Due Dates
You can set a service interval (in days) per asset or per client. AssetMinder calculates the next due date based on the last service date plus the interval. Overdue assets are highlighted on your dashboard. You can override intervals per asset in the asset's detail view.

## Trial Period
AssetMinder includes a free 14-day trial — no credit card required to start. Your trial begins when you first connect Jobber. After 14 days, you'll need a paid subscription to continue syncing and viewing data.

## Pricing and Subscription
AssetMinder costs $29/month. To subscribe:
1. Log in to AssetMinder.
2. Click "Subscribe" when prompted (or go to Account → Billing).
3. Enter your payment details on the Stripe checkout page.

Billing is handled securely by Stripe. You can cancel anytime from Account → Billing.

## Password / Login
You set your AssetMinder password in Account Settings (separate from your Jobber password). If you forget it:
1. Click "Forgot Password" on the login screen.
2. Enter your email address — we'll send a reset link valid for 1 hour.
3. Click the link in the email and set a new password.

If you didn't set a password yet, use the "Set Password" link in Account Settings after connecting Jobber.

## Disconnecting Jobber
Go to Account Settings → "Disconnect Jobber". This removes the OAuth connection but does NOT delete your synced data. You can reconnect at any time. Note: if you disconnect and reconnect with a different Jobber account, your existing asset data will remain but may not match the new account's jobs.

## Client Portal
AssetMinder can generate a shareable, read-only portal link for each client so they can view their asset service history. Go to a client's detail page → click "Share Portal" → copy the link to send to your customer.
`;
