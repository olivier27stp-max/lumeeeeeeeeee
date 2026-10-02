/* ══════════════════════════════════════════════════════════════
   BIBLIOTHÈQUE DE MODÈLES D'AUTOMATISATION — le contrat partagé.

   Avant (constaté le 2026-09-30) : « Partir d'un modèle » ne créait rien.
   Le bouton basculait sur l'onglet « Modèles », qui listait les VRAIES
   automatisations de l'entreprise encore en brouillon — cliquer un
   « modèle » modifiait l'automatisation elle-même, et en éteindre une la
   faisait « tomber » dans Modèles.

   Maintenant : un modèle est une définition GLOBALE en lecture seule. Le
   catalogue est construit côté serveur à partir des préréglages qui existent
   déjà (server/lib/automationTemplates.ts — aucune donnée recopiée) ; ce
   fichier-ci porte ce que le serveur ET l'écran partagent : les types, les
   catégories, et les fonctions pures (canaux, étapes, recherche, tri, nom
   libre, copie profonde des étapes).
   ═════════════════════════════════════════════════════════════ */

import type { Etape } from './sequenceTypes';
import { localizeAutomationName } from './automationNames';

export type CategorieModele =
  | 'soumissions'
  | 'bienvenue'
  | 'rendez_vous'
  | 'facturation'
  | 'apres_job'
  | 'relance_clients'
  | 'pipeline';

/** Ordre d'affichage des catégories — une catégorie vide est masquée. */
export const CATEGORIES_MODELES: ReadonlyArray<{ cle: CategorieModele; fr: string; en: string }> = [
  { cle: 'soumissions', fr: 'Suivi de soumissions', en: 'Quote follow-up' },
  { cle: 'bienvenue', fr: 'Bienvenue / nouveaux clients', en: 'Welcome / new clients' },
  { cle: 'rendez_vous', fr: 'Rendez-vous et rappels', en: 'Appointments and reminders' },
  { cle: 'facturation', fr: 'Facturation et paiements', en: 'Invoicing and payments' },
  { cle: 'apres_job', fr: 'Après la job (avis, satisfaction)', en: 'After the job (reviews, satisfaction)' },
  { cle: 'relance_clients', fr: 'Relance / réactivation de clients', en: 'Client win-back' },
  { cle: 'pipeline', fr: 'Pipeline / leads', en: 'Pipeline / leads' },
];

export type CanalModele = 'sms' | 'courriel' | 'tache' | 'notification' | 'avis' | 'pipeline';

export interface ModeleAutomatisation {
  /** Identifiant stable = la clé du préréglage d'origine. */
  id: string;
  categorie: CategorieModele;
  nom: { fr: string; en: string };
  description: { fr: string; en: string };
  declencheur: string;
  conditions: Record<string, unknown>;
  /** Délai avant la première action (négatif = avant le rendez-vous). Modèles sans `steps`. */
  delai_secondes: number;
  actions: Array<{ type: string; config: Record<string, unknown> }>;
  /** Parcours en étapes ; null = une seule vague d'actions après `delai_secondes`. */
  steps: Etape[] | null;
  settings: Record<string, unknown> | null;
  canaux: CanalModele[];
  nb_etapes: number;
  /** Métier visé ; null = toutes les entreprises. */
  industrie: string | null;
  /** AAAA-MM-JJ — sert au tri « Plus récent ». */
  ajoute_le: string;
}

const CANAL_DE_L_ACTION: Record<string, CanalModele> = {
  send_sms: 'sms',
  send_email: 'courriel',
  create_task: 'tache',
  create_notification: 'notification',
  request_review: 'avis',
  move_deal_stage: 'pipeline',
};

/**
 * Actions de journal interne (« note dans l'historique ») : absentes du
 * catalogue de l'éditeur, on ne peut ni les ajouter ni les régler.
 *
 * Elles sont pourtant COMPTÉES et montrées dans l'aperçu : la copie les garde
 * et l'éditeur en fait une carte (« Note dans l'historique — étape technique,
 * automatique »). Les retirer du compte annonçait « 3 étapes » pour une copie
 * qui en montrait 4, sur 33 modèles (audit du 2026-10-01).
 */
const ACTIONS_INTERNES = new Set(['log_activity']);

/** L'action figure-t-elle au catalogue de l'éditeur (faux = étape technique) ? */
export function actionVisible(type: string): boolean {
  return !ACTIONS_INTERNES.has(type);
}

/**
 * De quel côté d'un « si » se trouve l'étape : `alors` (si oui) ou `sinon`
 * (si non). Absent = le tronc du parcours, que tout le monde traverse.
 */
export type BrancheApercu = 'alors' | 'sinon';

/** Une étape telle que l'aperçu la montre, dans l'ordre d'exécution. */
export type EtapeApercu =
  | { genre: 'attente'; secondes: number; mode: 'duree' | 'reponse' | 'avant_date'; branche?: BrancheApercu }
  | { genre: 'action'; type: string; config: Record<string, unknown>; branche?: BrancheApercu }
  | { genre: 'condition'; conditions: Record<string, unknown>; branche?: BrancheApercu }
  | { genre: 'fin'; branche?: BrancheApercu };

/**
 * Les étapes dans l'ordre, TOUTES branches comprises — chacune une seule fois.
 *
 * Avant (audit du 2026-10-01) : on ne suivait que la branche « alors » d'un
 * « si ». La relance de devis (texto si le devis est parti par texto, sinon
 * courriel) était annoncée « 18 étapes » sans l'icône Courriel, alors qu'elle
 * en compte 23 dont 5 courriels — et l'aperçu ne montrait aucun courriel.
 *
 * Un « si » donne : la condition, sa branche « alors », sa branche « sinon »,
 * puis la suite commune à partir de l'étape où les deux se rejoignent. Les
 * sorties « si réponse » et « moment dépassé » d'une attente sont suivies à
 * la fin, si elles mènent à des étapes qu'on n'a pas encore vues.
 *
 * Un modèle simple = une attente (s'il a un délai) puis ses actions.
 */
export function etapesApercu(m: Pick<ModeleAutomatisation, 'steps' | 'actions' | 'delai_secondes'>): EtapeApercu[] {
  if (m.steps && m.steps.length > 0) {
    const parId = new Map(m.steps.map((e) => [e.id, e]));
    const out: EtapeApercu[] = [];
    const vues = new Set<string>();
    /** Sorties secondaires d'une attente, à reprendre une fois le tronc parcouru. */
    const aReprendre: string[] = [];

    const sorties = (e: Etape): Array<string | null | undefined> => (
      e.type === 'si' ? [e.alors, e.sinon]
        : e.type === 'attendre' ? [e.suivant, e.si_reponse, e.si_depasse]
          : e.type === 'action' ? [e.suivant] : []);

    /** Tout ce qu'on atteint depuis `depart`, du plus proche au plus lointain. */
    const atteignables = (depart: string | null | undefined): string[] => {
      const ordre: string[] = [];
      const file = depart ? [depart] : [];
      const dejaVu = new Set<string>();
      while (file.length > 0) {
        const id = file.shift() as string; // la file n'est pas vide
        const e = parId.get(id);
        if (!e || dejaVu.has(id)) continue;
        dejaVu.add(id);
        ordre.push(id);
        for (const s of sorties(e)) if (s) file.push(s);
      }
      return ordre;
    };

    const suivre = (depart: string | null | undefined, arret: ReadonlySet<string>, branche?: BrancheApercu): void => {
      let id = depart ?? undefined;
      while (id && !vues.has(id) && !arret.has(id)) {
        const e = parId.get(id);
        if (!e) return;
        vues.add(id);
        const cote = branche ? { branche } : {};
        if (e.type === 'action') {
          out.push({ genre: 'action', type: e.action.type, config: e.action.config, ...cote });
          id = e.suivant ?? undefined;
        } else if (e.type === 'attendre') {
          const mode = e.mode ?? 'duree';
          out.push({ genre: 'attente', secondes: mode === 'avant_date' ? -(e.secondes_avant ?? 0) : e.delai_secondes, mode, ...cote });
          for (const s of [e.si_reponse, e.si_depasse]) if (s) aReprendre.push(s);
          id = e.suivant ?? undefined;
        } else if (e.type === 'si') {
          out.push({ genre: 'condition', conditions: e.conditions, ...cote });
          // Là où les deux branches se rejoignent : la première étape du côté
          // « alors » qu'on atteint aussi par « sinon ». Sans jonction (une
          // branche s'arrête), chaque côté va jusqu'au bout.
          const coteSinon = new Set(atteignables(e.sinon));
          const jonction = atteignables(e.alors).find((x) => coteSinon.has(x));
          const borne = jonction ? new Set([...arret, jonction]) : arret;
          suivre(e.alors, borne, 'alors');
          suivre(e.sinon, borne, 'sinon');
          id = jonction;
        } else {
          out.push({ genre: 'fin', ...cote });
          return;
        }
      }
    };

    suivre(m.steps[0].id, new Set());
    while (aReprendre.length > 0) suivre(aReprendre.shift(), new Set());
    return out;
  }
  const out: EtapeApercu[] = [];
  if (m.delai_secondes !== 0) out.push({ genre: 'attente', secondes: m.delai_secondes, mode: 'duree' });
  for (const a of m.actions) out.push({ genre: 'action', type: a.type, config: a.config });
  return out;
}

export function nbEtapes(m: Pick<ModeleAutomatisation, 'steps' | 'actions' | 'delai_secondes'>): number {
  return etapesApercu(m).filter((e) => e.genre !== 'fin').length;
}

export function canauxDe(m: Pick<ModeleAutomatisation, 'steps' | 'actions' | 'delai_secondes'>): CanalModele[] {
  const vus = new Set<CanalModele>();
  for (const e of etapesApercu(m)) {
    if (e.genre === 'action') {
      const c = CANAL_DE_L_ACTION[e.type];
      if (c) vus.add(c);
    }
  }
  const ordre: CanalModele[] = ['sms', 'courriel', 'notification', 'tache', 'avis', 'pipeline'];
  return ordre.filter((c) => vus.has(c));
}

/**
 * Le texte d'un courriel HTML, lisible, sans jamais injecter de HTML. Sert à
 * l'aperçu des modèles ET au résumé d'une carte du canevas, qui affichait
 * « <div style="font-family:sans-serif… » (Rafba, 2026-09-30).
 */
export function texteSansHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Minuscules sans accents : « Relancé » trouve « relance ». */
export function normaliser(texte: string): string {
  return texte.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

export type TriModeles = 'recent' | 'nom' | 'etapes';

export function filtrerModeles(
  modeles: readonly ModeleAutomatisation[],
  { recherche, categories, fr }: { recherche: string; categories: ReadonlySet<CategorieModele>; fr: boolean },
): ModeleAutomatisation[] {
  const q = normaliser(recherche);
  return modeles.filter((m) => {
    if (categories.size > 0 && !categories.has(m.categorie)) return false;
    if (!q) return true;
    const cat = CATEGORIES_MODELES.find((c) => c.cle === m.categorie);
    const foin = normaliser([
      fr ? m.nom.fr : m.nom.en,
      fr ? m.description.fr : m.description.en,
      cat ? (fr ? cat.fr : cat.en) : '',
    ].join(' '));
    return foin.includes(q);
  });
}

export function trierModeles(modeles: readonly ModeleAutomatisation[], tri: TriModeles, fr: boolean): ModeleAutomatisation[] {
  const copie = [...modeles];
  const nom = (m: ModeleAutomatisation) => (fr ? m.nom.fr : m.nom.en);
  if (tri === 'nom') return copie.sort((a, b) => nom(a).localeCompare(nom(b), fr ? 'fr' : 'en'));
  if (tri === 'etapes') return copie.sort((a, b) => b.nb_etapes - a.nb_etapes || nom(a).localeCompare(nom(b), fr ? 'fr' : 'en'));
  return copie.sort((a, b) => b.ajoute_le.localeCompare(a.ajoute_le) || nom(a).localeCompare(nom(b), fr ? 'fr' : 'en'));
}

/**
 * « Relance » déjà pris → « Relance (2) », puis « Relance (3) »…
 *
 * Un nom existant est pris sous TOUTES ses formes affichées : un préréglage est
 * stocké sous son nom anglais (« Contract Signed ») et montré traduit
 * (« Contrat signé »). Comparer aux seuls noms stockés donnait à la copie le nom
 * exact d'une ligne déjà à l'écran — deux « Contrat signé » impossibles à
 * distinguer (triage « modèles », 02-chaque-modele:351).
 */
export function nomDisponible(nom: string, existants: Iterable<string>): string {
  const pris = new Set<string>();
  for (const existant of existants) {
    const n = existant.trim();
    for (const forme of [n, localizeAutomationName(n, 'fr'), localizeAutomationName(n, 'en')]) pris.add(forme.trim().toLowerCase());
  }
  if (!pris.has(nom.trim().toLowerCase())) return nom;
  for (let i = 2; ; i += 1) {
    const candidat = `${nom} (${i})`;
    if (!pris.has(candidat.toLowerCase())) return candidat;
  }
}

/**
 * Copie profonde d'un parcours avec de NOUVEAUX identifiants d'étape, et
 * chaque renvoi (`suivant`, `alors`, `sinon`, `si_reponse`, `si_depasse`)
 * réécrit vers la nouvelle étape. Aucune étape du modèle n'est partagée
 * avec la copie.
 */
export function copierEtapes(etapes: readonly Etape[], nouvelId: () => string): Etape[] {
  const correspondance = new Map<string, string>();
  for (const e of etapes) correspondance.set(e.id, nouvelId());
  const renvoi = (v: string | null | undefined) => (v ? correspondance.get(v) ?? null : v ?? null);
  return etapes.map((e) => {
    const c = JSON.parse(JSON.stringify(e)) as Etape;
    c.id = correspondance.get(e.id) as string;
    if (c.type === 'action' || c.type === 'attendre') c.suivant = renvoi(c.suivant);
    if (c.type === 'attendre') {
      if ('si_reponse' in c) c.si_reponse = renvoi(c.si_reponse);
      if ('si_depasse' in c) c.si_depasse = renvoi(c.si_depasse);
    }
    if (c.type === 'si') { c.alors = renvoi(c.alors); c.sinon = renvoi(c.sinon); }
    return c;
  });
}
