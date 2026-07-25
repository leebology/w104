import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The web app lives in src/ with index.html at the repo root.
// The PartyServer worker (party/) is deployed separately and is ignored by Vite.
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist" },
  // host: true binds to 0.0.0.0 (not just localhost) so the dev server is
  // reachable from phones on the same wifi. See .env.example for the other
  // half of LAN testing (VITE_PARTYKIT_HOST).
  server: { host: true },
});
