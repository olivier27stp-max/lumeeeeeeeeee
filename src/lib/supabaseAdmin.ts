// ⚠️ STUB FILE — DO NOT USE FROM CLIENT CODE ⚠️
//
// The real `supabaseAdmin` lives at `server/lib/supabaseAdmin.ts` (it uses
// the service-role key, which must NEVER ship in the browser bundle).
//
// This file exists only because the Dockerfile/build pipeline historically
// referenced `src/lib/supabaseAdmin.ts` and aggressive Railway/BuildKit
// caches still try to resolve it (commit c12b767 moved the real impl out
// of `src/` but the cache layer pinning persisted). A truly empty file or
// a deleted file breaks `COPY src/lib/supabaseAdmin.ts` directives that
// linger in cached build plans.
//
// If any code imports this from `src/`, the thrown error makes the leak
// loud and obvious instead of silently shipping a working admin client to
// every browser session.
//
// To delete this stub safely:
//   1. Confirm no `import` statements reference `src/lib/supabaseAdmin`
//      in the client tree (`grep -r 'src/lib/supabaseAdmin' src/`).
//   2. Remove every cache layer in Railway/BuildKit that referenced the
//      old path.
//   3. Delete this file and the matching `COPY` directive (if any) from
//      the Dockerfile.

export function getSupabaseAdminClient(): never {
  throw new Error(
    'src/lib/supabaseAdmin.ts is a stub — import the real client from server/lib/supabaseAdmin.ts. ' +
    'Service-role clients must never be used in browser code.'
  );
}

export default getSupabaseAdminClient;
