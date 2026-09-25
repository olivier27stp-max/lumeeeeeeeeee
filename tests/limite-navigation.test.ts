// Changer de page ne doit JAMAIS déclencher « Too many requests ».
//
// CE QUE CE TEST PROTÈGE. Le limiteur global bloquait à 40 requêtes par
// 3 secondes, par utilisateur, pour 60 secondes. Un chargement de page coûte
// 7 à 8 appels (mesuré le 2026-09-06, commenté dans security.ts) : CINQ
// changements de page en trois secondes suffisaient donc à rendre toute
// l'application inutilisable pendant une minute.
//
// C'est le rythme normal de quelqu'un qui cherche quelque chose en cliquant
// dans le menu. Rafba l'a signalé le 2026-09-25 : « ça me dit ça quand je
// spam de changer de page ».
//
// On fixe donc un plancher : assez haut pour la navigation humaine, assez
// bas pour arrêter un vrai martèlement.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const APPELS_PAR_PAGE = 8;      // le haut de la fourchette mesurée
const PAGES_A_TOLERER = 12;     // une exploration nerveuse, pas un robot

function limiteurs(): { burstMax: number; burstWindowMs: number; blockDurationMs: number; parIp: boolean }[] {
  const src = fs.readFileSync('server/lib/security.ts', 'utf8');
  const out: any[] = [];
  const re = /slidingRateLimit\(\{([\s\S]*?)\}\)\);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const bloc = m[1];
    const nb = (cle: string) => {
      const v = bloc.match(new RegExp(`${cle}:\\s*([0-9_]+)`));
      return v ? Number(v[1].replace(/_/g, '')) : NaN;
    };
    out.push({
      burstMax: nb('burstMax'),
      burstWindowMs: nb('burstWindowMs'),
      blockDurationMs: nb('blockDurationMs'),
      parIp: /extractIP/.test(bloc),
    });
  }
  return out.filter((l) => Number.isFinite(l.burstMax));
}

describe('limite de débit — la navigation doit passer', () => {
  it('le limiteur par utilisateur laisse au moins 12 pages en 3 s', () => {
    const parUtilisateur = limiteurs().filter((l) => !l.parIp);
    expect(parUtilisateur.length, 'aucun limiteur par utilisateur trouvé').toBeGreaterThan(0);

    for (const l of parUtilisateur) {
      const pages = Math.floor(l.burstMax / APPELS_PAR_PAGE);
      expect(
        pages,
        `burstMax=${l.burstMax} → seulement ${pages} pages en ${l.burstWindowMs}ms. `
        + `Une page coûte ~${APPELS_PAR_PAGE} appels : il en faut ${PAGES_A_TOLERER} au moins.`,
      ).toBeGreaterThanOrEqual(PAGES_A_TOLERER);
    }
  });

  it('un blocage ne dure pas plus de 30 secondes', () => {
    // Soixante secondes d'application morte pour une rafale de clics, c'est
    // une punition hors de proportion — et l'utilisateur croit que l'app est
    // cassée. La fenêtre longue (max/minute) reste là pour les insistants.
    for (const l of limiteurs().filter((x) => !x.parIp)) {
      expect(l.blockDurationMs).toBeLessThanOrEqual(30_000);
    }
  });

  it('la limite par IP reste au-dessus de celle par utilisateur', () => {
    // Sinon c'est l'IP qui bloque en premier, et un bureau entier tombe à
    // cause d'une seule personne — le défaut qu'on avait déjà corrigé le
    // 2026-09-06 en séparant les deux couches.
    const parUser = limiteurs().filter((l) => !l.parIp).map((l) => l.burstMax);
    const parIp = limiteurs().filter((l) => l.parIp).map((l) => l.burstMax);
    if (!parIp.length) return;
    expect(Math.min(...parIp)).toBeGreaterThanOrEqual(Math.max(...parUser));
  });
});
