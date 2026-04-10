// In dev, VITE_API_URL is empty and Vite's proxy handles /api → localhost:3001.
// In production, VITE_API_URL is the full backend URL e.g. https://assetminder-backend.onrender.com
export const API = import.meta.env.VITE_API_URL ?? "";
