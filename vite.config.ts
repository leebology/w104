import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { version } from "./package.json" with { type: "json" };

// The web app lives in src/ with index.html at the repo root.
// The PartyServer worker (party/) is deployed separately and is ignored by Vite.
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist" },
  // The version in Landing's corner comes from package.json rather than a
  // literal in the JSX, so bumping the package is the only place it changes.
  define: { __APP_VERSION__: JSON.stringify(version) },
  // host: true binds to 0.0.0.0 (not just localhost) so the dev server is
  // reachable from phones on the same wifi. See .env.example for the other
  // half of LAN testing (VITE_PARTYKIT_HOST).
  server: { host: true },
});
