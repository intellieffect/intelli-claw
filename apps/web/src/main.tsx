import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initCryptoAdapter } from "@intelli-claw/shared";
import { WebCryptoAdapter } from "./adapters/crypto";
import { App } from "./App";
import { ThemeProvider } from "./lib/theme";
import "./styles/globals.css";

// Initialize platform adapters
initCryptoAdapter(new WebCryptoAdapter());

// Tag <html> so CSS can target Electron-specific styles
if ("electronAPI" in window) {
  document.documentElement.classList.add("electron");
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
