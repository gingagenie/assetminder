import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Intercept all fetch calls — dispatch event when API returns 402
const _originalFetch = window.fetch.bind(window);
window.fetch = async function (...args: Parameters<typeof fetch>) {
  const response = await _originalFetch(...args);
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
