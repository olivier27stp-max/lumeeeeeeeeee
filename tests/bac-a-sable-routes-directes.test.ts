/**
 * Bac à sable des envois : le filet ENTREPRISE vaut pour toutes les routes
 * authentifiées, pas seulement pour le moteur d'automatisations.
 *
 * Canari du 2026-10-01 (prod, bureau de test inscrit au bac à sable) : un
 * courriel envoyé par POST /api/communications/send-email était consigné avec
 * org_id = null et raison = « destinataire ». L'entreprise n'était connue que
 * dans executeAction ; vers une vraie adresse, le courriel serait parti.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../server/lib/supabase', () => ({
  getServiceClient: () => ({
    from: () => ({ select: async () => ({ data: [{ org_id: 'org-bac', mode: 'succes' }], error: null }) }),
  }),
}));

import { contexteEnvoiParRequete, poserOrgDuContexte, orgDuContexte, verdictBacASable, oublierBacASable } from '../server/lib/bac-a-sable';

/** Joue une requête : le middleware, puis un gestionnaire qui s'authentifie APRÈS une attente (comme requireAuthedClient). */
async function requete(orgAuthentifiee: string | null, corps: () => Promise<void>): Promise<void> {
  await new Promise<void>((fin, echec) => {
    contexteEnvoiParRequete()(null, null, () => {
      (async () => {
        const authentifier = async () => { await Promise.resolve(); poserOrgDuContexte(orgAuthentifiee); };
        await authentifier();
        await corps();
      })().then(fin, echec);
    });
  });
}

describe('bac à sable — routes directes', () => {
  beforeEach(() => { process.env.BAC_A_SABLE_EN_TEST = '1'; oublierBacASable(); });
  afterEach(() => { delete process.env.BAC_A_SABLE_EN_TEST; oublierBacASable(); });

  it('l’entreprise posée à l’authentification est vue par le reste de la requête', async () => {
    await requete('org-bac', async () => { await Promise.resolve(); expect(orgDuContexte()).toBe('org-bac'); });
  });

  it('bureau en bac à sable + VRAIE adresse : simulé, par le filet entreprise', async () => {
    await requete('org-bac', async () => {
      const v = await verdictBacASable(null, ['vrai.client@gmail.com']);
      expect(v).toMatchObject({ simule: true, raison: 'entreprise', orgId: 'org-bac' });
    });
  });

  it('un vrai bureau n’est jamais simulé', async () => {
    await requete('org-reelle', async () => {
      expect(await verdictBacASable(null, ['vrai.client@gmail.com'])).toMatchObject({ simule: false, raison: null });
    });
  });

  it('deux requêtes simultanées ne se mélangent pas', async () => {
    const vus: Array<string | null> = [];
    await Promise.all([
      requete('org-bac', async () => { await new Promise((r) => setTimeout(r, 15)); vus.push(orgDuContexte()); }),
      requete('org-reelle', async () => { await new Promise((r) => setTimeout(r, 5)); vus.push(orgDuContexte()); }),
      requete(null, async () => { await new Promise((r) => setTimeout(r, 10)); vus.push(orgDuContexte()); }),
    ]);
    expect(vus.sort()).toEqual([null, 'org-bac', 'org-reelle'].sort());
  });

  it('hors requête (cron, tâche de fond) : sans effet, sans erreur', () => {
    expect(() => poserOrgDuContexte('org-bac')).not.toThrow();
    expect(orgDuContexte()).toBeNull();
  });

  it('branchement : le middleware suit les analyseurs de corps, et l’authentification pose l’entreprise', () => {
    const index = readFileSync(resolve(__dirname, '../server/index.ts'), 'utf8');
    expect(index.indexOf('app.use(contexteEnvoiParRequete());')).toBeGreaterThan(index.indexOf("app.use(express.json({ limit: '512kb' }));"));
    const auth = readFileSync(resolve(__dirname, '../server/lib/supabase.ts'), 'utf8');
    expect(auth.match(/poserOrgDuContexte\(/g)?.length).toBe(2);
  });
});
