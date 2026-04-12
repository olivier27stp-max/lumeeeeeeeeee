/**
 * Centralized avatar URLs for all reps.
 * Use getRepAvatar(name) to get a consistent avatar across all pages.
 */

// Avatar URLs loaded dynamically from user profiles — no hardcoded mappings
const REP_AVATARS: Record<string, string> = {};

export function getRepAvatar(name: string): string | null {
  return REP_AVATARS[name] ?? null;
}
