import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/globals.css";

// Tag <html> so CSS can target Electron-specific styles
if ("electronAPI" in window) {
  document.documentElement.classList.add("electron");
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
