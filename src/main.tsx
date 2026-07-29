import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { DebugPanel } from "./components/DebugPanel";
// Self-hosted rather than loaded from Google: Bungee has no near system
// fallback, so a phone on bad party wifi would render the entire design in
// whatever sans-serif it has. Bundling them keeps the look independent of the
// network the game is being played on.
import "@fontsource/bungee/400.css";
import "@fontsource/archivo/400.css";
import "@fontsource/archivo/600.css";
import "./style.css";
import { trackVisualViewport } from "./viewport";

// Before the first render: every locked screen sizes itself from the
// variables this publishes.
trackVisualViewport();

createRoot(document.getElementById("app")!).render(
  <StrictMode>
    <App />
    {/* Mounted beside App rather than inside it: App returns a different tree
        per screen, so anything inside would have to be repeated at each of its
        five return sites — and the panel must outlive every one of them.
        Renders nothing at all outside staging and local builds. */}
    <DebugPanel />
  </StrictMode>,
);
