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
  /**
   * Ce qu'on attend.
   *
   * `duree` (défaut, et le seul comportement d'avant) : un délai fixe.
   *
   * `reponse` : on attend la réponse du client, au plus `delai_secondes`.
   * C'est le « Wait for Contact Reply » de GoHighLevel, et le plus utile
   * pour une relance : il rend inutile la moitié des conditions. Le moteur
   * regarde s'il y a un message ENTRANT ; si oui, il saute directement à
   * `si_reponse` (ou arrête le parcours), sinon il continue vers `suivant`
   * une fois le délai écoulé.
   *
   * Absent = `duree` : les parcours déjà enregistrés ne changent pas.
   */
  mode?: 'duree' | 'reponse';
  /**
   * Où aller si le client a répondu. Absent = le parcours s'arrête —
   * c'est le cas le plus fréquent : il a répondu, on ne relance plus.
   */
  si_reponse?: string | null;
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

// ── Le format D'ORIGINE (`actions`) ─────────────────────────
//
// Avant le builder visuel, une règle portait une LISTE PLATE d'actions et un
// seul `delay_seconds` partagé. Ce format n'est pas mort : mesuré en
// production le 2026-09-25, **250 règles sur 251** l'utilisent encore. Le
// canevas, lui, ne lit que `steps` — il affichait donc « Ajouter une
// première étape » sur des automatisations actives qui envoient vraiment des
// messages. L'éditeur mentait à presque tous les clients.
//
// On PROJETTE donc `actions` dans la forme du canevas, pour l'AFFICHER.
// C'est une lecture, jamais une écriture : la règle en base n'est pas
// touchée tant que l'utilisateur n'a pas explicitement demandé la
// conversion.

/** Une règle au format d'origine a-t-elle quelque chose à montrer ? */
export function estFormatOrigine(regle: {
  steps?: unknown;
  actions?: unknown;
}): boolean {
  const steps = Array.isArray(regle.steps) ? regle.steps : [];
  const actions = Array.isArray(regle.actions) ? regle.actions : [];
  return steps.length === 0 && actions.length > 0;
}

/**
 * `actions` + `delay_seconds` → les étapes que le canevas sait dessiner.
 *
 * Fidélité d'abord : on montre ce que la règle fait VRAIMENT, sinon on
 * remplace un mensonge (canevas vide) par un autre. Donc :
 *   · le délai partagé devient une étape « attendre » EN TÊTE — c'est bien
 *     ce que le moteur fait : il attend, puis exécute tout ;
 *   · les actions se suivent dans leur ordre de stockage, qui est l'ordre
 *     d'exécution ;
 *   · un type inconnu du catalogue (`log_activity`, écriture interne du
 *     moteur) est conservé tel quel : le masquer donnerait un parcours
 *     incomplet, et c'est précisément le défaut qu'on corrige.
 */
export function projeterFormatOrigine(regle: {
  actions?: unknown;
  delay_seconds?: number | null;
}): Etape[] {
  const actions = Array.isArray(regle.actions) ? regle.actions : [];
  if (actions.length === 0) return [];

  const etapes: Etape[] = [];
  const delai = Number(regle.delay_seconds) || 0;

  // Les identifiants sont STABLES (« origine-0 », « origine-1 »…) : un id
  // tiré au hasard ferait remonter une carte différente à chaque rendu et
  // casserait la sélection.
  if (delai > 0) {
    etapes.push({
      id: 'origine-attente',
      type: 'attendre',
      delai_secondes: delai,
      suivant: 'origine-0',
    });
  }

  actions.forEach((brut, i) => {
    const a = (brut ?? {}) as { type?: string; config?: Record<string, string> };
    etapes.push({
      id: `origine-${i}`,
      type: 'action',
      action: { type: String(a.type ?? ''), config: a.config ?? {} },
      suivant: i + 1 < actions.length ? `origine-${i + 1}` : null,
    });
  });

  return etapes;
}

/**
 * Ce qu'une conversion ferait — AVANT de la faire.
 *
 * Exigence de Will : « la conversion doit être validée avant d'être
 * appliquée (dry-run ou diff visible — l'utilisateur doit voir ce qui va
 * changer avant de confirmer) ».
 *
 * Le cas qui oblige à ce contrôle : `log_activity` écrit la trace interne
 * (`activity_log`) et n'est PAS au catalogue, donc le serveur refuse un
 * parcours qui en contient — mesuré en prod le 2026-09-25 : 100 règles sur
 * 250 en portent une. Les convertir en la retirant ferait disparaître leur
 * historique en silence. On refuse donc la conversion plutôt que de mutiler
 * la règle, et on le DIT.
 */
export interface ApercuConversion {
  /** La conversion est-elle possible sans rien perdre ? */
  possible: boolean;
  /** Les étapes telles qu'elles seraient enregistrées. */
  etapes: Etape[];
  /** Les types d'action qui empêchent la conversion, en clair. */
  bloquants: string[];
}

/** Les types que le catalogue ne connaît pas et que le serveur refusera. */
const TYPES_HORS_CATALOGUE = ['log_activity', 'send_notification', 'update_status'];

export function apercuConversion(regle: {
  actions?: unknown;
  delay_seconds?: number | null;
}): ApercuConversion {
  const etapes = projeterFormatOrigine(regle);
  const bloquants = [...new Set(
    etapes
      .filter((e): e is EtapeAction => e.type === 'action')
      .map((e) => e.action.type)
      .filter((t) => TYPES_HORS_CATALOGUE.includes(t)),
  )];
  return { possible: etapes.length > 0 && bloquants.length === 0, etapes, bloquants };
}
