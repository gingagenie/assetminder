import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Intercept all fetch calls: send the session cookie on every request (auth is
// now cookie-based), and dispatch an event when the API returns 402.
const _originalFetch = window.fetch.bind(window);
window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
  const merged: RequestInit = { ...init, credentials: init?.credentials ?? "include" };
  const response = await _originalFetch(input, merged);
  if (response.status === 402) {
    window.dispatchEvent(new CustomEvent("subscription_required"));
  }
  return response;
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
