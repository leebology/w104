/// <reference types="vite/client" />

// The reference lives here rather than as `"types": ["vite/client"]` in
// tsconfig.json, and the difference is load-bearing for the *deployment*, not
// for this project. Vercel compiles `middleware.ts` by writing a tsconfig into
// the OS temp directory that `extends` ours, and a bare package name in
// `types` is resolved from the directory of the config that names it — from
// `%TEMP%` there is no `node_modules/vite` to find, so the compile fails with
// TS2688, emits nothing, and the build dies with "TypeScript did not emit an
// output for middleware.ts". A triple-slash reference resolves relative to
// *this* file instead, which is inside the project, and the middleware compile
// never loads it: Vercel's temp config sets `files` to the one entrypoint.

/** Replaced at build time by Vite's `define` with package.json's version. */
declare const __APP_VERSION__: string;
