/**
 * L'interrupteur Brouillon / Publiée ne doit JAMAIS finir dans un état
 * différent de la base, même quand on le martèle (Rafba, 2026-09-28).
 */
import { describe, it, expect } from 'vitest';
import { creerFileBascule } from '../../src/lib/fileBascule';

/** Faux serveur : latences variables → réponses dans le désordre si on envoyait en parallèle. */
function fauxServeur(initial: boolean, echouerAu?: number) {
  let base = initial;
  let appels = 0;
  let enParallele = 0;
  let maxParallele = 0;
  return {
    get base() { return base; },
    get appels() { return appels; },
    get maxParallele() { return maxParallele; },
    envoyer: async (_id: string, actif: boolean) => {
      appels++;
      enParallele++;
      maxParallele = Math.max(maxParallele, enParallele);
      await new Promise((r) => setTimeout(r, 5 + Math.random() * 20));
      enParallele--;
      if (echouerAu !== undefined && appels === echouerAu) throw new Error('réseau');
      base = actif;
    },
  };
}
const attendreFin = (f: { enCours: (id: string) => boolean }) => new Promise<void>((ok) => {
  const t = setInterval(() => { if (!f.enCours('r')) { clearInterval(t); ok(); } }, 5);
});

describe('file de bascule', () => {
  it.each([1, 2, 3, 7, 15, 16])('%i clics d’affilée → la base finit sur ce que l’écran affiche', async (n) => {
    const s = fauxServeur(false);
    const f = creerFileBascule({ envoyer: s.envoyer });
    let affiche = false;
    for (let i = 0; i < n; i++) {
      affiche = f.basculer('r', affiche);
      if (i % 3 === 1) await new Promise((r) => setTimeout(r, 7)); // clics irréguliers
    }
    await attendreFin(f);
    expect(affiche).toBe(n % 2 === 1);
    expect(s.base).toBe(affiche);
    expect(s.maxParallele).toBe(1);
  });

  it('15 clics rapides = au plus 2 requêtes', async () => {
    const s = fauxServeur(false);
    const f = creerFileBascule({ envoyer: s.envoyer });
    let affiche = false;
    for (let i = 0; i < 15; i++) affiche = f.basculer('r', affiche);
    await attendreFin(f);
    expect(s.appels).toBeLessThanOrEqual(2);
    expect(s.base).toBe(true);
  });

  it('un échec ramène l’écran au dernier état confirmé', async () => {
    const s = fauxServeur(false, 1);
    let retour: boolean | null = null;
    const f = creerFileBascule({ envoyer: s.envoyer, surEchec: (_id, r) => { retour = r; } });
    f.basculer('r', false);
    await attendreFin(f);
    expect(retour).toBe(false);
    expect(s.base).toBe(false);
    // et on peut rebasculer normalement ensuite
    expect(f.basculer('r', false)).toBe(true);
    await attendreFin(f);
    expect(s.base).toBe(true);
  });

  it('pendant une bascule, l’état affiché suit le dernier clic', () => {
    const f = creerFileBascule({ envoyer: () => new Promise(() => {}) });
    f.basculer('r', false);
    f.basculer('r', true /* valeur périmée ignorée */);
    expect(f.etatAffiche('r', false)).toBe(false);
    f.basculer('r', false);
    expect(f.etatAffiche('r', false)).toBe(true);
  });
});
