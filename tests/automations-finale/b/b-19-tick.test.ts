/**
 * B-19 — la trace du dernier tick terminé, contre la VRAIE base (pile locale) :
 * la table `cron_locks` l'accepte, elle se relit, et elle ne gêne pas le verrou
 * du planificateur.
 *
 * On n'exécute PAS le tick lui-même : il dépile la file de toutes les
 * entreprises de la pile, pas seulement celle de nos bureaux.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { preparerBureau, type Bureau } from '../../automations-suite/integration/10-b-outils';

let b: Bureau & { fuseau: string };
beforeAll(async () => { b = await preparerBureau(); });

describe('B-19 — trace du tick du planificateur', () => {
  it('[B19-01] un tick terminé écrit son début et sa fin ; `etatDuTick` les relit ; le verrou du planificateur reste prenable', async () => {
    const { noterTickTermine, etatDuTick } = await import('../../../server/lib/scheduler');
    const fin = Date.now();
    await noterTickTermine(b.admin, fin - 4_000, fin);
    const etat = await etatDuTick(b.admin);
    expect(etat.dernier_tick_fin).toBe(new Date(fin).toISOString());
    expect(etat.duree_ms).toBe(4_000);
    expect(etat.en_retard).toBe(false);
    expect(etat.age_s).toBeLessThan(30);

    // Une seule ligne, réécrite à chaque tick.
    await noterTickTermine(b.admin, fin - 1_000, fin + 1_000);
    expect((await etatDuTick(b.admin)).duree_ms).toBe(2_000);

    // La trace n'est pas un verrou : une clé jamais prise se prend, puis se relâche.
    const cle = 987_654_321;
    const { data: pris, error } = await b.admin.rpc('try_advisory_lock', { p_key: cle });
    expect(error).toBeNull();
    expect(pris).toBe(true);
    await b.admin.rpc('release_advisory_lock', { p_key: cle });
    // … et la trace a survécu au relâchement d'un autre verrou.
    expect((await etatDuTick(b.admin)).dernier_tick_fin).toBeTruthy();
  });
});
