/**
 * Courriel d'avertissement « crédits Lumi » au propriétaire (2026-09-30) :
 * à 80 % puis à 100 %, UNE fois par seuil et par période, en crédits
 * seulement, dans la langue de chacun, propriétaires actifs seulement.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const notifs = vi.hoisted(() => ({ appels: [] as Array<{ recipients: Map<string, string>; titre: string }> }));
vi.mock('../server/lib/mailer', () => ({ isMailerConfigured: () => true, sendEmail: vi.fn() }));
vi.mock('../server/lib/supabase', async (orig) => ({ ...(await orig<object>()), companyOrgIds: async (_a: unknown, o: string) => [o, 'bureau-2'] }));
vi.mock('../server/lib/notificationHelpers', () => ({
  insertTargetedNotifications: vi.fn(async (_s: unknown, _o: string, recipients: Map<string, string>, build: (l: 'fr' | 'en') => { title: string }) => {
    notifs.appels.push({ recipients, titre: build('fr').title });
  }),
}));

import { avertirSiSeuilCredits, textesAvis } from '../server/lib/lumi/avis-credits';
import type { EtatCredits } from '../server/lib/lumi/credits';

const etat = (p: Partial<EtatCredits>): EtatCredits => ({
  inclus: true, total: 1000, utilises: 800, restants: 200, pourcentage: 80, renouvellement_le: '2026-11-12', palier: 'econome', avertissement: '80', ...p,
});

/** Base simulée : `dejaEnvoye` = la ligne (groupe, période, seuil) existe déjà. */
function base(dejaEnvoye: boolean) {
  const upserts: unknown[] = [];
  const admin = {
    from: (table: string) => {
      const q: any = {};
      for (const m of ['select', 'eq', 'in']) q[m] = () => q;
      q.maybeSingle = async () => ({ data: table === 'orgs' ? { company_group_id: 'groupe-1' } : null, error: null });
      q.upsert = (ligne: unknown) => { upserts.push(ligne); return { select: async () => ({ data: dejaEnvoye ? [] : [{ seuil: 80 }], error: null }) }; };
      q.then = (r: any) => r({ data: table === 'memberships' ? [
        { user_id: 'proprio-fr', status: 'active', language: 'fr' },
        { user_id: 'proprio-en', status: 'active', language: 'en' },
        { user_id: 'proprio-suspendu', status: 'suspended', language: 'fr' },
      ] : [], error: null });
      return q;
    },
    rpc: async () => ({ data: '2026-10-12', error: null }),
    auth: { admin: { getUserById: async (id: string) => ({ data: { user: { email: `${id}@exemple.test` } } }) } },
  };
  return { admin: admin as never, upserts };
}

beforeEach(() => { notifs.appels.length = 0; });

describe('textes : en crédits, jamais en $', () => {
  it('80 % : restants, total et vraie date de renouvellement (FR et EN)', () => {
    const fr = textesAvis(80, etat({}), 'fr');
    expect(fr.sujet).toBe('Il te reste 200 crédits Lumi');
    // fr-CA sépare les milliers par une espace fine insécable (correct à l'affichage).
    expect(fr.intro.replace(/[\u202f\u00a0]/g, ' ')).toBe('Il te reste 200 crédits Lumi sur 1 000 jusqu’au 12 novembre, date où ils se renouvellent.');
    const en = textesAvis(80, etat({}), 'en');
    expect(en.intro).toBe('You have 200 of 1,000 Lumi credits left until November 12, when they renew.');
  });
  it('100 % : épuisé, pause jusqu’au renouvellement, le reste de Lume marche', () => {
    const fr = textesAvis(100, etat({ restants: 0, avertissement: '100', palier: 'epuise' }), 'fr');
    expect(fr.sujet).toBe('Tes crédits Lumi sont épuisés');
    expect(fr.intro).toContain('en pause jusqu’au 12 novembre');
    expect(fr.note).toContain('tout le reste de Lume');
  });
  it('aucun montant en dollars, dans aucune langue ni aucun seuil', () => {
    for (const s of [80, 100] as const) for (const l of ['fr', 'en'] as const) {
      expect(JSON.stringify(textesAvis(s, etat({}), l))).not.toMatch(/\$|dollar|\d+[.,]\d\d\s?\$/i);
    }
  });
});

describe('envoi : une fois par seuil et par période, aux propriétaires actifs', () => {
  it('80 % la première fois : courriel à chaque propriétaire ACTIF dans sa langue + notification', async () => {
    const { sendEmail } = await import('../server/lib/mailer');
    const envoyer = vi.fn(async () => ({ sent: true }));
    const { admin, upserts } = base(false);
    await avertirSiSeuilCredits(admin, 'org-1', etat({}), envoyer as never);
    expect(upserts).toEqual([{ company_group_id: 'groupe-1', periode: '2026-10-12', seuil: 80 }]);
    const destinataires = (envoyer.mock.calls as any[]).map((c) => c[0].to).sort();
    expect(destinataires).toEqual(['proprio-en@exemple.test', 'proprio-fr@exemple.test']);   // pas le suspendu
    const en = (envoyer.mock.calls as any[]).find((c) => c[0].to.startsWith('proprio-en'))[0];
    expect(en.subject).toBe('You have 200 Lumi credits left');
    expect(en.html).toContain('/settings/billing');
    expect(notifs.appels[0].recipients.size).toBe(2);
    expect(vi.mocked(sendEmail)).not.toHaveBeenCalled();                                       // l'envoyeur injecté seulement
  });
  it('déjà averti pour ce seuil et cette période : rien ne repart', async () => {
    const envoyer = vi.fn(async () => ({ sent: true }));
    await avertirSiSeuilCredits(base(true).admin, 'org-1', etat({}), envoyer as never);
    expect(envoyer).not.toHaveBeenCalled();
    expect(notifs.appels).toHaveLength(0);
  });
  it('100 % : c’est le seuil 100 qui est réservé', async () => {
    const envoyer = vi.fn(async () => ({ sent: true }));
    const { admin, upserts } = base(false);
    await avertirSiSeuilCredits(admin, 'org-1', etat({ restants: 0, avertissement: '100', palier: 'epuise' }), envoyer as never);
    expect(upserts).toEqual([{ company_group_id: 'groupe-1', periode: '2026-10-12', seuil: 100 }]);
    expect((envoyer.mock.calls as any[])[0][0].subject).toBe('Tes crédits Lumi sont épuisés');
  });
  it('sous 80 %, ou forfait sans Lumi : rien du tout', async () => {
    const envoyer = vi.fn(async () => ({ sent: true }));
    const { admin, upserts } = base(false);
    await avertirSiSeuilCredits(admin, 'org-1', etat({ avertissement: null, pourcentage: 40 }), envoyer as never);
    await avertirSiSeuilCredits(admin, 'org-1', etat({ inclus: false }), envoyer as never);
    expect(upserts).toHaveLength(0);
    expect(envoyer).not.toHaveBeenCalled();
  });
});

describe('branché dans la route Lumi', () => {
  it('au début de chaque requête ET après chaque réponse du modèle', async () => {
    const { readFileSync } = await import('node:fs');
    const route = readFileSync('server/routes/lumi.ts', 'utf8');
    expect(route).toMatch(/void avertirSiSeuilCredits\(admin, auth\.orgId, credits\);/);
    expect(route).toMatch(/void avertirSiSeuilCredits\(ctx\.admin, ctx\.auth\.orgId, creditsApres\);/);
  });
});
