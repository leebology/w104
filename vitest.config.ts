import { defineConfig } from "vitest/config";

// Game logic in shared/ is pure — it needs no DOM and no Cloudflare runtime,
// which is the whole reason it lives outside party/.
export default defineConfig({
  test: {
    environment: "node",
    include: ["shared/**/*.test.ts"],
  },
});
