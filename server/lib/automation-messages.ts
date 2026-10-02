/* ═══════════════════════════════════════════════════════════════
   Les MESSAGES d'une automatisation — la logique, sans réseau.

   Un texto ou un courriel vit à UN endroit, selon la règle :

     · `steps` posé (un tableau, MÊME VIDE) : la règle a un parcours. C'est la
       seule source de vérité — le moteur n'exécute que lui. `actions` n'en est
       qu'un reflet, réécrit à chaque écriture (les actions du parcours, dans
       l'ordre). On ne relit jamais `actions` d'une règle qui a un parcours.
     · `steps` nul : la règle est « à plat », ses messages sont dans `actions`.

   Une règle peut envoyer PLUSIEURS messages du même canal (deux textos, deux
   courriels) : on en désigne toujours UN, jamais « tous ceux du canal » —
   c'est ce qui recopiait le texte du premier dans le second (triage « modèles »
   du 2026-10-01, MSG-010 et MSG-036).

   La route `PATCH /api/automations/rules/:id/messages`
   (server/routes/automation-messages.ts) est la seule à écrire ; le navigateur
   garde une copie de la partie LECTURE (`messagesDeRegle`, `texteQuiPart`) dans
   src/lib/automationRulesApi.ts — `src/` n'importe pas `server/`. La parité est
   tenue par tests/automations-finale/t/messages-route.test.ts.
   ═══════════════════════════════════════════════════════════════ */

import { trouverAction } from '../../src/lib/automationCatalogue';

export type Canal = 'send_sms' | 'send_email';
export type Config = Record<string, unknown>;
export interface Action { type: string; config: Config }
export type Etape = Record<string, unknown> & { id?: unknown; type?: unknown; action?: { type?: unknown; config?: Config } | null };

/* Les plafonds sont ceux du CATALOGUE de l'éditeur — une seule source : un
   texte accepté dans l'éditeur plein écran l'est ici, et l'inverse. Les nombres
   écrits en dur ne servent que si le catalogue perdait le champ. */
const plafond = (action: string, champ: string, repli: number): number =>
  trouverAction(action)?.champs.find((c) => c.cle === champ)?.max ?? repli;
/** Plafond d'un texto — champ « Texte du message » de « Envoyer un texto ». */
export const TEXTO_MAX = plafond('send_sms', 'body', 1600);
/** Plafonds d'un courriel — champs « Objet » et « Message » de « Envoyer un courriel ». */
export const OBJET_MAX = plafond('send_email', 'subject', 200);
export const COURRIEL_MAX = plafond('send_email', 'body', 10000);
/** Plafond du champ `actions` côté serveur (`corpsAutomatisation`, server/lib/validation.ts). */
const ACTIONS_REFLET_MAX = 20;

export interface RegleLue {
  actions?: unknown;
  steps?: unknown;
}

/** Un message d'une règle, tel qu'on le désigne. */
export interface MessageDeRegle {
  canal: Canal;
  /** Rang parmi les messages du MÊME canal, dans l'ordre du parcours (0 = le premier). */
  rang: number;
  /** Parcours : l'étape qui le porte. */
  etapeId?: string;
  /** Règle à plat : l'index de l'action dans `actions`. */
  indexAction?: number;
  config: Config;
}

export interface Cible {
  etapeId?: string;
  indexAction?: number;
  rang?: number;
  /** Le texte français (`body`) et l'objet (`subject`) lus par l'écran à l'ouverture. */
  corpsLu?: string;
  objetLu?: string;
}

/** Ce qu'on écrit dans le message. Un champ absent reste tel quel ; une version anglaise vide est RETIRÉE. */
export interface Ecriture {
  body?: string;
  subject?: string;
  body_en?: string;
  subject_en?: string;
}

/** Les étapes d'un parcours dans l'ordre où il les rencontre : le fil principal, puis les embranchements. */
export function etapesDansLOrdre(steps: unknown): Etape[] {
  const etapes = (Array.isArray(steps) ? steps : []) as Array<Etape | null | undefined>;
  const parId = new Map<string, Etape>();
  for (const e of etapes) if (e && typeof e.id === 'string') parId.set(e.id, e);
  const ordre: Etape[] = [];
  const vues = new Set<string>();
  const premiere = etapes[0]?.id;
  const pile: string[] = typeof premiere === 'string' ? [premiere] : [];
  while (pile.length) {
    const id = pile.pop() as string;
    const etape = parId.get(id);
    if (!etape || vues.has(id)) continue;
    vues.add(id);
    ordre.push(etape);
    const suites = etape.type === 'si'
      ? [etape.alors, etape.sinon]
      : etape.type === 'arreter' ? [] : [etape.suivant, etape.si_reponse, etape.si_depasse];
    for (const s of [...suites].reverse()) if (typeof s === 'string' && !vues.has(s)) pile.push(s);
  }
  // Une étape que rien n'atteint (brouillon en cours de câblage) : gardée, à la fin.
  for (const e of etapes) if (e && typeof e.id === 'string' && !vues.has(e.id)) ordre.push(e);
  return ordre;
}

/**
 * `actions`, reflet d'un parcours : ses actions, dans l'ordre, sans attente ni
 * condition. Même parcours et même ordre que `actionsDuParcours`
 * (src/lib/publicationAutomatisation.ts), que l'éditeur écrit à chaque
 * enregistrement — les deux écritures doivent donner le même reflet.
 */
export function refletDuParcours(steps: unknown): Action[] {
  return etapesDansLOrdre(steps)
    .flatMap((e) => (e.type === 'action' && typeof e.action?.type === 'string' && e.action.type
      ? [{ type: e.action.type, config: { ...(e.action.config ?? {}) } }]
      : []))
    .slice(0, ACTIONS_REFLET_MAX);
}

const estCanal = (type: unknown): type is Canal => type === 'send_sms' || type === 'send_email';

/**
 * Les textos et courriels qu'une règle envoie, dans l'ordre. `steps` posé
 * (même vide) : ceux du parcours, jamais ceux d'`actions`.
 */
export function messagesDeRegle(regle: RegleLue | null | undefined, canal?: Canal): MessageDeRegle[] {
  const porteurs: Array<{ type: unknown; etapeId?: string; indexAction?: number; config: Config }> = Array.isArray(regle?.steps)
    ? etapesDansLOrdre(regle?.steps)
      .filter((e) => e.type === 'action' && e.action)
      .map((e) => ({ type: e.action?.type, etapeId: String(e.id), config: e.action?.config ?? {} }))
    : (Array.isArray(regle?.actions) ? (regle?.actions as Action[]) : [])
      .map((a, indexAction) => ({ type: a?.type, indexAction, config: a?.config ?? {} }));
  const rangs: Record<string, number> = {};
  const messages: MessageDeRegle[] = [];
  for (const p of porteurs) {
    if (!estCanal(p.type)) continue;
    const rang = rangs[p.type] ?? 0;
    rangs[p.type] = rang + 1;
    if (!canal || p.type === canal) messages.push({ canal: p.type, rang, etapeId: p.etapeId, indexAction: p.indexAction, config: p.config });
  }
  return messages;
}

/**
 * Le texte d'un champ tel que le moteur l'ENVOIE dans une langue : la version
 * anglaise si le bureau écrit en anglais et qu'elle est renseignée, sinon le
 * français (`champLocalise`, server/lib/actions).
 */
export function texteQuiPart(config: Config | null | undefined, champ: 'body' | 'subject', langue: 'fr' | 'en' = 'fr'): string {
  if (langue === 'en') {
    const en = config?.[`${champ}_en`];
    if (typeof en === 'string' && en.trim()) return en;
  }
  return String(config?.[champ] ?? '');
}

export type RaisonSansMessage = 'aucun' | 'plusieurs' | 'modifie_ailleurs';

/**
 * Le message désigné par `cible`, ou la raison pour laquelle il n'y en a pas
 * exactement un. Sans cible, on n'accepte que s'il n'y a qu'UN message du canal.
 */
export function messageVise(messages: MessageDeRegle[], cible: Cible): { message: MessageDeRegle } | { raison: RaisonSansMessage; nombre: number } {
  const nombre = messages.length;
  const memeTexte = (m: MessageDeRegle) => (cible.corpsLu === undefined || String(m.config.body ?? '') === cible.corpsLu)
    && (cible.objetLu === undefined || String(m.config.subject ?? '') === cible.objetLu);
  const lu = cible.corpsLu !== undefined || cible.objetLu !== undefined;
  const ailleurs = { raison: 'modifie_ailleurs' as const, nombre };

  if (cible.etapeId !== undefined || cible.indexAction !== undefined) {
    const m = messages.find((x) => (cible.etapeId !== undefined ? x.etapeId === cible.etapeId : x.indexAction === cible.indexAction));
    return m && memeTexte(m) ? { message: m } : ailleurs;
  }
  if (cible.rang !== undefined) {
    const m = messages.find((x) => x.rang === cible.rang);
    if (m && memeTexte(m)) return { message: m };
    // Le rang ne désigne plus le même texte (un message ajouté ou retiré
    // ailleurs) : on ne retombe sur le texte lu que s'il désigne un seul message.
    const memes = lu ? messages.filter(memeTexte) : [];
    return memes.length === 1 ? { message: memes[0] } : ailleurs;
  }
  if (lu) {
    // Deux messages au texte identique : le premier — les deux se valent.
    const m = messages.find(memeTexte);
    return m ? { message: m } : ailleurs;
  }
  if (nombre === 1) return { message: messages[0] };
  return { raison: nombre === 0 ? 'aucun' : 'plusieurs', nombre };
}

/** Le texte lisible d'un corps (HTML ou non) : vide = rien à envoyer. */
export const texteVisible = (html: string): string => html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').trim();

/** La configuration du message après l'écriture. */
export function configApres(config: Config | undefined, canal: Canal, ecriture: Ecriture): Config {
  const courriel = canal === 'send_email';
  const neuf: Config = { ...(config ?? {}) };
  if (ecriture.body !== undefined) neuf.body = ecriture.body;
  if (courriel && ecriture.subject !== undefined) neuf.subject = ecriture.subject;
  const anglais: Array<['body_en' | 'subject_en', string | undefined]> = [
    ['body_en', ecriture.body_en],
    ['subject_en', courriel ? ecriture.subject_en : undefined],
  ];
  for (const [cle, valeur] of anglais) {
    if (valeur === undefined) continue;
    const vide = cle === 'body_en' ? !texteVisible(valeur) : !valeur.trim();
    if (vide) delete neuf[cle]; else neuf[cle] = valeur;
  }
  return neuf;
}

/**
 * Ce qu'on écrit en base pour modifier CE message, et lui seul. Parcours : les
 * étapes ET le reflet `actions`, ensemble. Règle à plat : `actions` seul (on
 * n'invente pas de parcours).
 */
export function ecritureDeRegle(regle: RegleLue, vise: MessageDeRegle, ecriture: Ecriture): { actions: Action[]; steps?: Etape[] } {
  if (Array.isArray(regle.steps)) {
    const steps = (regle.steps as Etape[]).map((e) => (e && e.id === vise.etapeId
      ? { ...e, action: { ...e.action, config: configApres(e.action?.config, vise.canal, ecriture) } }
      : e));
    return { steps, actions: refletDuParcours(steps) };
  }
  const actions = (Array.isArray(regle.actions) ? (regle.actions as Action[]) : [])
    .map((a, i) => (i === vise.indexAction ? { ...a, config: configApres(a.config, vise.canal, ecriture) } : a));
  return { actions };
}
