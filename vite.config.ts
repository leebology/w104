import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { version } from "./package.json" with { type: "json" };

/**
 * Serves `/privacy` from `public/privacy/index.html` on the dev server.
 *
 * Vite hands `public/` to sirv with extension resolution turned off, so the
 * only path that matches is the exact `/privacy/index.html`; and its HTML
 * fallback looks for `<root>/privacy.html`, never inside `public/`. So a
 * request for `/privacy` falls all the way through to the SPA fallback and
 * renders the game — the About panel's link appearing to do nothing.
 *
 * Vercel resolves a directory index by itself, and `vercel.json` pins that
 * rather than trusting it. This is the dev half of the same rule: the page has
 * one URL and it is `/privacy` everywhere.
 */
function privacyPage(): Plugin {
  return {
    name: "w104-privacy-page",
    apply: "serve",
    configureServer(server) {
      // Registered here rather than in a returned function, so it runs before
      // Vite's own middlewares and the rewritten URL still reaches the one
      // that serves public/.
      server.middlewares.use((req, _res, next) => {
        const [path, query] = (req.url ?? "").split("?");
        if (path === "/privacy" || path === "/privacy/") {
          req.url = `/privacy/index.html${query ? `?${query}` : ""}`;
        }
        next();
      });
    },
  };
}

// The web app lives in src/ with index.html at the repo root.
// The PartyServer worker (party/) is deployed separately and is ignored by Vite.
export default defineConfig({
  plugins: [react(), privacyPage()],
  build: { outDir: "dist" },
  // The version in Landing's corner comes from package.json rather than a
  // literal in the JSX, so bumping the package is the only place it changes.
  define: { __APP_VERSION__: JSON.stringify(version) },
  // host: true binds to 0.0.0.0 (not just localhost) so the dev server is
  // reachable from phones on the same wifi. See .env.example for the other
  // half of LAN testing (VITE_PARTYKIT_HOST).
  server: { host: true },
});
