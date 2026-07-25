import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The web app lives in src/ with index.html at the repo root.
// The PartyServer worker (party/) is deployed separately and is ignored by Vite.
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist" },
});
