// Tests the REAL active-office security/scoping logic shared by the auth
// middleware (requireAuthedClient) and the leaderboard route.
import { describe, it, expect } from 'vitest';
import {
  ORG_UUID_RE,
  shouldUseRequestedOrg,
  leaderboardOrgIds,
} from '../server/lib/active-org';

const ORG_A = '11111111-1111-1111-1111-111111111111';
const ORG_B = '22222222-2222-2222-2222-222222222222';

describe('shouldUseRequestedOrg — anti-IDOR gate for x-org-id / ?orgId', () => {
  it('honors a valid office id ONLY when the user is a member', () => {
    expect(shouldUseRequestedOrg(ORG_B, true)).toBe(true);
  });

  it('rejects a valid office id when the user is NOT a member', () => {
    // The crux: a user cannot read another office by forging the header.
    expect(shouldUseRequestedOrg(ORG_B, false)).toBe(false);
  });

  it('rejects a malformed office id even if "member" is somehow true', () => {
    expect(shouldUseRequestedOrg('not-a-uuid', true)).toBe(false);
    expect(shouldUseRequestedOrg('"; DROP TABLE orgs;--', true)).toBe(false);
  });

  it('rejects empty / missing values → caller falls back to current_org_id()', () => {
    expect(shouldUseRequestedOrg('', true)).toBe(false);
    expect(shouldUseRequestedOrg(undefined, true)).toBe(false);
    expect(shouldUseRequestedOrg(null, true)).toBe(false);
  });
});

describe('ORG_UUID_RE', () => {
  it('accepts canonical UUIDs, rejects junk', () => {
    expect(ORG_UUID_RE.test(ORG_A)).toBe(true);
    expect(ORG_UUID_RE.test('123')).toBe(false);
    expect(ORG_UUID_RE.test(`${ORG_A} or 1=1`)).toBe(false);
  });
});

describe('leaderboardOrgIds — scope resolution', () => {
  const group = [ORG_A, ORG_B];

  it("'mine' spans only the active office (no cross-office data)", () => {
    expect(leaderboardOrgIds('mine', ORG_A, group)).toEqual([ORG_A]);
  });

  it("'all' spans every office of the company group", () => {
    expect(leaderboardOrgIds('all', ORG_A, group)).toEqual([ORG_A, ORG_B]);
  });

  it("'all' with an empty group falls back to the active office alone", () => {
    expect(leaderboardOrgIds('all', ORG_A, [])).toEqual([ORG_A]);
  });
});
