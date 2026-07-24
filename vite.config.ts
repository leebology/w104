import { defineConfig } from "vite";

// The web app lives in src/ with index.html at the repo root.
// The PartyKit server (party/) is deployed separately and is ignored by Vite.
export default defineConfig({
  build: {
    outDir: "dist",
  },
});
