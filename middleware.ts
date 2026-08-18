/**
 * Staging's front door.
 *
 * `staging.oknameone.com` is a branch domain of the same Vercel project that
 * serves production, and Vercel's own Deployment Protection cannot guard it:
 * Hobby allows exactly one external user, so the second friend handed the URL
 * cannot get in at all (see "Deployment protection must be off" in HOSTING.md).
 * This is the replacement — one shared password, a cookie, and nothing else.
 *
 * **It gates the page, not the game.** The Worker the page talks to is a
 * different origin and stays open; a room is still protected by its code and
 * by the per-IP connect budget in `party/server.ts`. What this stops is a
 * stranger finding a half-built build of the game, which is the whole of the
 * threat being modelled.
 *
 * Three things about the shape of it:
 *
 * - **Production is checked first and returns immediately.** The same
 *   middleware is deployed to every environment because it is one project, so
 *   the guard against ever locking `www.oknameone.com` has to live in the code
 *   rather than in a dashboard field somebody can mis-scope.
 * - **A missing password means no password**, the arrangement `JOIN_LIMITER`
 *   has in `wrangler.jsonc` and for the same reason: an environment deployed
 *   before the variable existed must not fail closed and take every preview
 *   down with it. It logs, so the reason is in the function logs rather than
 *   in someone's memory.
 * - **No `@vercel/functions` import.** Its `next()` helper is the documented
 *   way to pass a request through, and it costs 126 packages in a project with
 *   six runtime dependencies. Returning nothing is the same thing — it is what
 *   the "match paths based on conditional statements" example in Vercel's own
 *   middleware docs relies on for every path it does not handle.
 */

// Vercel's Edge runtime populates `process.env` from the project's environment
// variables. Declared here because this project's tsconfig carries no
// `@types/node`, and one field of one global is not worth pulling them in.
declare const process: { env: Record<string, string | undefined> };

// NOTE: line comments, not a `/** */` block, and that is not a style choice.
// Vercel reads this object with a static analyser before the file is ever
// compiled, and a JSDoc block anywhere inside `config` fails that read with
// `Error: Unhandled type: "ColonToken" :` — a build error naming no file, no
// line, and nothing that suggests a comment. The comment needs no colon of its
// own; the one it chokes on is `matcher:` below. Reproduce with `vercel build`.
//
// Documents only. Hashed bundles, fonts and audio all land under `/assets/`
// and are not secret — gating them would spend a middleware invocation per
// file per page load against Hobby's monthly allowance to protect a
// stylesheet. The extension list catches anything served straight out of
// `public/`, which `/assets/` does not cover.
//
// `.html` is deliberately absent from that list, so `/index.html` is gated
// as well as `/`. A gate with the unminified front door left open beside it
// is not a gate.
export const config = {
  matcher: [
    "/((?!assets/|.*\\.(?:js|mjs|css|map|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf|mp3|ogg|wav|webmanifest|txt|xml)$).*)",
  ],
};

/**
 * Not `VITE_`-prefixed, and that is load-bearing rather than a naming
 * preference: Vite inlines every `VITE_*` variable into the client bundle at
 * build time, so the prefix alone would publish the password on the page it is
 * meant to be protecting.
 */
const SECRET_VAR = "STAGING_PASSWORD";

const COOKIE = "w104_staging";

/** Long enough that a tester is not re-challenged across an evening of play. */
const MAX_AGE_SEC = 60 * 60 * 24 * 30;

export default async function middleware(request: Request): Promise<Response | undefined> {
  // Never, under any circumstances, the real site.
  if (process.env.VERCEL_ENV === "production") return undefined;

  const secret = process.env[SECRET_VAR];
  if (!secret) {
    console.warn(`${SECRET_VAR} is not set — this deployment is open to anyone with the URL.`);
    return undefined;
  }

  /**
   * The cookie carries the hash, never the password, so a value read off a
   * device is not a value that can be typed at the form on another one. It
   * also means **rotating the password signs everybody out** with no session
   * list to keep: the expected cookie value is derived from the secret, so
   * changing the secret invalidates every cookie already issued.
   */
  const token = await sha256(secret);
  const url = new URL(request.url);

  // The form.
  if (request.method === "POST") {
    const form = await request.formData().catch(() => null);
    const given = String(form?.get("password") ?? "");
    if (!(await matches(given, token))) return challenge(true);
    return unlock(new URL(url.pathname, url), token);
  }

  /**
   * The link. `?key=<password>` unlocks and redirects to the same path with
   * the parameter stripped, which is what makes this shareable as one tap in a
   * message rather than as a URL plus a password to read out. A wrong key
   * falls through to the form rather than looping.
   */
  const key = url.searchParams.get("key");
  if (key !== null && (await matches(key, token))) {
    const clean = new URL(url);
    clean.searchParams.delete("key");
    return unlock(clean, token);
  }

  if (cookie(request, COOKIE) === token) return undefined;

  return challenge(false);
}

// --------------------------------------------------------------- responses

/**
 * 303 rather than 302: the form's POST must become a GET on the way back, or
 * the redirect re-posts and the browser's back button re-submits.
 */
function unlock(to: URL, token: string): Response {
  return new Response(null, {
    status: 303,
    headers: {
      Location: to.pathname + to.search,
      "Set-Cookie": `${COOKIE}=${token}; Path=/; Max-Age=${MAX_AGE_SEC}; HttpOnly; Secure; SameSite=Lax`,
      "Cache-Control": "no-store",
    },
  });
}

/**
 * 401 with a form in the body, and **no `WWW-Authenticate` header** — that
 * header is what makes a browser throw its own credentials dialog over the
 * page, which is the version of this that in-app browsers handle badly. The
 * status is still 401 so anything automated reads it correctly.
 *
 * Self-contained on purpose: the app's stylesheet is an asset request, and a
 * gate that depends on the thing behind the gate is a gate with a hole in it.
 */
function challenge(wrong: boolean): Response {
  const body = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>OK Name One — staging</title>
<style>
  :root { color-scheme: dark; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    background: #16121c; color: #f4ecdf; padding: 24px;
    font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  main { width: 100%; max-width: 22rem; }
  h1 { margin: 0 0 4px; font-size: 1.25rem; letter-spacing: 0.02em; }
  p { margin: 0 0 20px; opacity: 0.65; font-size: 0.9rem; }
  label { display: block; margin-bottom: 6px; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.65; }
  input, button { width: 100%; box-sizing: border-box; font: inherit; border-radius: 6px; }
  input { padding: 12px; margin-bottom: 12px; border: 2px solid #453b52; background: #221c2b; color: inherit; }
  input:focus { outline: none; border-color: #29b3a6; }
  button { padding: 12px; border: none; background: #29b3a6; color: #10202a; font-weight: 600; cursor: pointer; }
  .wrong { color: #ff8f7a; font-size: 0.85rem; margin: -4px 0 12px; }
</style>
</head>
<body>
  <main>
    <h1>Staging</h1>
    <p>A test build of OK Name One. Not the real thing.</p>
    <form method="post">
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" autofocus required>
      ${wrong ? '<p class="wrong">Not that one.</p>' : ""}
      <button type="submit">Enter</button>
    </form>
  </main>
</body>
</html>`;

  return new Response(body, {
    status: 401,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

// ----------------------------------------------------------------- compare

/**
 * Both sides are hashed before they meet, which gives the comparison a fixed
 * length for free and keeps the plaintext out of the branch. Overkill for a
 * password shouted across a living room, but it is four lines.
 */
async function matches(given: string, token: string): Promise<boolean> {
  return equal(await sha256(given), token);
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant time over two equal-length hex strings. */
function equal(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Parsed by hand rather than with a cookie library. One name, and the value is
 * hex — so there is nothing to unescape and no edge case worth a dependency.
 */
function cookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}
