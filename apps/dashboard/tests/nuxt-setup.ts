/**
 * No-op `setup()` shim for integration tests.
 *
 * Historically the tests imported `setup` from `@nuxt/test-utils/e2e` and
 * called `setup({ server: true, port: 3000, ... })`. In practice the real
 * test bootstrap is `bun run dev` in a separate terminal: tests use
 * `apiFetch` from `../helpers` which hits `process.env.TEST_BASE_URL`
 * (defaulting to `http://localhost:3000`). The `setup()` call did nothing
 * useful — its rootDir auto-resolve failed from the monorepo root, and
 * making it actually start a server would collide with the dev server on
 * the same port.
 *
 * This shim keeps the call-sites unchanged while making them a no-op so
 * `bun test` from the monorepo root doesn't die on rootDir resolution.
 */
export async function setup(_options: unknown = {}) {
  // intentional no-op
}
