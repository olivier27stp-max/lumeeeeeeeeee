/**
 * `LUMI_OUTILS_LOTS=0` retire les 30 outils des lots du 2026-10-01, et rien d'autre.
 *
 * Ces outils sont entrés en prod sans mesure de leur effet sur la qualité des réponses (la base
 * de prod est tombée pendant la passe d'évaluation). L'interrupteur permet de mesurer avec et
 * sans, et de se replier sans revert : il doit rendre EXACTEMENT le jeu d'outils d'avant.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

async function charger(valeur: string | undefined) {
  vi.resetModules();
  if (valeur === undefined) delete process.env.LUMI_OUTILS_LOTS;
  else process.env.LUMI_OUTILS_LOTS = valeur;
  const { AGENT_TOOLS } = await import('../server/lib/agent/tools');
  const { TOPICS } = await import('../server/lib/lumi/topics');
  const { REGISTRE_ECRITURES } = await import('../server/lib/agent/registre');
  const { PERMISSION_PAR_OUTIL } = await import('../server/lib/agent/garde');
  return { noms: AGENT_TOOLS.map((t) => t.declaration.name), topics: TOPICS, registre: REGISTRE_ECRITURES, permissions: PERMISSION_PAR_OUTIL };
}

describe('interrupteur des lots d’outils', () => {
  const avant = process.env.LUMI_OUTILS_LOTS;
  afterEach(() => { if (avant === undefined) delete process.env.LUMI_OUTILS_LOTS; else process.env.LUMI_OUTILS_LOTS = avant; vi.resetModules(); });

  it('par défaut, les 30 outils sont là', async () => {
    const { noms } = await charger(undefined);
    for (const n of ['create_deal', 'update_time_entry', 'get_payroll_amounts', 'pause_all_automations', 'restore_archived']) expect(noms, n).toContain(n);
  });

  it('à 0 : les 30 outils disparaissent des outils, des sujets, du registre et des permissions', async () => {
    const avec = await charger(undefined);
    const sans = await charger('0');
    const retires = avec.noms.filter((n) => !sans.noms.includes(n));
    expect(retires).toHaveLength(30);
    expect(sans.noms.filter((n) => !avec.noms.includes(n))).toEqual([]);
    // L'ordre des outils restants ne bouge pas : les préfixes de cache d'avant sont retrouvés tels quels.
    expect(sans.noms).toEqual(avec.noms.filter((n) => !retires.includes(n)));
    const dansUnSujet = new Set(sans.topics.flatMap((t) => t.outils));
    for (const n of retires) {
      expect(dansUnSujet.has(n), `${n} encore dans un sujet`).toBe(false);
      expect(n in sans.registre, `${n} encore au registre`).toBe(false);
      expect(n in sans.permissions, `${n} encore dans les permissions`).toBe(false);
    }
  });
});
