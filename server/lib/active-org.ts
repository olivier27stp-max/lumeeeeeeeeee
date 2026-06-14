// Pure helpers for resolving the "active office" a request operates on.
//
// An office = an org. A user can be a member of several offices of the same
// company (company_group_id). The server only knows the *first* membership via
// current_org_id(), so the client transmits the office it's actually viewing
// (x-org-id header, or ?orgId on the leaderboard). These helpers centralize the
// security rule for honoring that hint and the leaderboard scope resolution, so
// both the auth middleware and the leaderboard route share — and test — the
// exact same logic.

export const ORG_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether to honor a client-supplied office id. ONLY when it is a well-formed
 * UUID AND the authenticated user is genuinely a member of it (anti-IDOR).
 * Otherwise the caller must fall back to current_org_id() (first membership).
 */
export function shouldUseRequestedOrg(
  requested: string | undefined | null,
  isMember: boolean
): boolean {
  return !!requested && ORG_UUID_RE.test(requested) && isMember === true;
}

/**
 * The set of offices a leaderboard query spans.
 *  - 'mine' → the active office only (no data crosses between offices).
 *  - 'all'  → every office of the company group (cross-office competition).
 * Falls back to the active office alone if the group resolved to nothing.
 */
export function leaderboardOrgIds(
  scope: 'mine' | 'all',
  activeOrgId: string,
  groupOrgIds: string[]
): string[] {
  if (scope === 'mine') return [activeOrgId];
  return groupOrgIds.length > 0 ? groupOrgIds : [activeOrgId];
}
