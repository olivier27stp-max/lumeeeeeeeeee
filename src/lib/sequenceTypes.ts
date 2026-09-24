/* ═══════════════════════════════════════════════════════════════
   La forme d'une séquence, côté navigateur.

   Les mêmes types que `server/lib/automationSequences.ts`, redéclarés ici
   parce que `src/` n'a pas le droit d'importer `server/`
   (`tests/frontiere-serveur-client.test.ts`) — et que l'inverse, faire vivre
   ces types sous `src/`, obligerait le moteur à dépendre du front pour son
   cœur d'exécution.

   `tests/automatisations-sequences.test.ts` compare les deux déclarations :
   si l'une change sans l'autre, le test échoue. Deux copies qui divergent en
   silence seraient pires qu'une dépendance.
   ═══════════════════════════════════════════════════════════════ */

export type TypeEtape = 'action' | 'attendre' | 'si' | 'arreter';

export interface EtapeAction {
  id: string;
  type: 'action';
  action: { type: string; config: Record<string, string | undefined> };
  suivant?: string | null;
  /**
   * Le nom que l'utilisateur donne a cette etape.
   *
   * Sans lui, un parcours qui envoie trois courriels affiche trois cartes
   * « Envoyer un courriel » impossibles a distinguer. C'est le champ
   * « Action Name » de GoHighLevel, et il ne sert qu'a l'affichage : le
   * moteur ne le lit jamais.
   */
  nom?: string | null;
}

export interface EtapeAttendre {
  id: string;
  type: 'attendre';
  delai_secondes: number;
  suivant?: string | null;
}

export interface EtapeSi {
  id: string;
  type: 'si';
  conditions: Record<string, unknown>;
  alors?: string | null;
  sinon?: string | null;
}

export interface EtapeArreter {
  id: string;
  type: 'arreter';
}

export type Etape = EtapeAction | EtapeAttendre | EtapeSi | EtapeArreter;

/**
 * Un identifiant d'étape court et stable.
 *
 * Il voyage jusque dans `execution_key` (l'anti-doublon du moteur) : il doit
 * donc rester lisible dans un journal et ne jamais contenir de `:`, qui sert
 * de séparateur dans la clé. Un compteur plutôt qu'un UUID — « e3 » se lit,
 * se cherche et tient dans une clé.
 */
export function nouvelIdEtape(existants: Etape[]): string {
  const pris = new Set(existants.map((e) => e.id));
  for (let i = 1; i <= 999; i++) {
    const candidat = `e${i}`;
    if (!pris.has(candidat)) return candidat;
  }
  // Inatteignable en pratique : une séquence est bornée à 20 étapes côté
  // serveur. Le repli garantit malgré tout un identifiant unique.
  return `e${Date.now()}`;
}

/** Une étape neuve, du type demandé, prête à être insérée. */
export function etapeVierge(type: TypeEtape, id: string): Etape {
  switch (type) {
    case 'action':
      return { id, type: 'action', action: { type: 'send_sms', config: { body: '' } }, suivant: null };
    case 'attendre':
      return { id, type: 'attendre', delai_secondes: 86400, suivant: null };
    case 'si':
      return { id, type: 'si', conditions: {}, alors: null, sinon: null };
    case 'arreter':
      return { id, type: 'arreter' };
  }
}

/**
 * Insère une étape dans le graphe, après `apresId`.
 *
 * `apresId` à `null` = en tête de séquence. `branche` précise laquelle des
 * deux suites d'un « si » reprendre.
 *
 * L'étape insérée HÉRITE de la suite de celle qu'elle suit : câbler une
 * nouvelle carte au milieu ne doit pas couper ce qui venait après, sinon
 * ajouter une attente entre deux messages ferait disparaître le second.
 */
export function insererEtape(
  steps: Etape[],
  nouvelle: Etape,
  apresId: string | null,
  branche?: 'alors' | 'sinon',
): Etape[] {
  if (apresId === null) {
    // En tête : la nouvelle pointe vers l'ancienne première.
    const ancienneTete = steps[0]?.id ?? null;
    const avecSuite = nouvelle.type === 'arreter' || nouvelle.type === 'si'
      ? nouvelle
      : { ...nouvelle, suivant: ancienneTete };
    return [avecSuite, ...steps];
  }

  return [
    ...steps.map((e) => {
      if (e.id !== apresId) return e;
      if (e.type === 'si') {
        const cle = branche ?? 'alors';
        // La nouvelle reprend la branche qu'elle remplace.
        if (nouvelle.type !== 'arreter' && nouvelle.type !== 'si') {
          (nouvelle as EtapeAction | EtapeAttendre).suivant = e[cle] ?? null;
        }
        return { ...e, [cle]: nouvelle.id };
      }
      if (e.type === 'arreter') return e;
      if (nouvelle.type !== 'arreter' && nouvelle.type !== 'si') {
        (nouvelle as EtapeAction | EtapeAttendre).suivant = e.suivant ?? null;
      }
      return { ...e, suivant: nouvelle.id };
    }),
    nouvelle,
  ];
}

/**
 * Retire une étape et recoud le parcours.
 *
 * Ce qui pointait vers elle pointe désormais vers sa suite : supprimer une
 * carte au milieu ne doit pas amputer la fin de la séquence.
 */
export function retirerEtape(steps: Etape[], id: string): Etape[] {
  const cible = steps.find((e) => e.id === id);
  if (!cible) return steps;
  const suite = cible.type === 'si' ? (cible.alors ?? null)
    : cible.type === 'arreter' ? null
    : (cible.suivant ?? null);

  return steps
    .filter((e) => e.id !== id)
    .map((e) => {
      if (e.type === 'si') {
        return {
          ...e,
          alors: e.alors === id ? suite : e.alors,
          sinon: e.sinon === id ? suite : e.sinon,
        };
      }
      if (e.type === 'arreter') return e;
      return { ...e, suivant: e.suivant === id ? suite : e.suivant };
    });
}
