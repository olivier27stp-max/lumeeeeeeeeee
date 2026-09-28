/**
 * Place des custom keys dans un formulaire de base (demande de Rafba, 2026-09-28) :
 * « quand tu ajoutes une custom key, le formulaire s'ouvre, te propose un spot,
 * tu la glisses à la bonne place, tu sauvegardes ».
 *
 * Une place = dossier (la section si c'est un dossier système) + `config.apres`
 * (la rangée de base qu'elle suit) + `position` (l'ordre entre custom keys).
 * Fonctions pures : le formulaire (useChampsCreation) et la fenêtre de placement
 * (PlacerChampFenetre) lisent la même règle.
 */
import { SECTIONS_SYSTEME, ancresFormulaire, champsSysteme, nomDossier, rangeesFormulaire } from './standard';
import type { ChampPerso, DossierChamp, ObjetChamp } from './types';

/** Ancre retenue pour un champ, ou null (fin de section) si elle ne correspond plus à rien. */
export function ancreValide(objet: ObjetChamp, champ: ChampPerso, sectionDuChamp: string | null): string | null {
  const a = champ.config?.apres;
  if (!a || !sectionDuChamp || !ancresFormulaire(objet).has(a)) return null;
  const rangee = rangeesFormulaire(objet).find((r) => r.cles[0] === a);
  return rangee && rangee.section === sectionDuChamp ? a : null;
}

export type ElementPlan =
  | { type: 'entete'; id: string; dossierId: string | null; section: string | null; titre: string }
  | { type: 'rangee'; id: string; section: string; cle: string; libelle: string }
  | { type: 'champ'; id: string; champ: ChampPerso };

const parPosition = (a: ChampPerso, b: ChampPerso) => (a.position ?? 0) - (b.position ?? 0);

/** Le formulaire tel qu'il s'affiche : sections, rangées de base, custom keys à leur place. */
export function planFormulaire(objet: ObjetChamp, champs: ChampPerso[], dossiers: DossierChamp[], fr: boolean): ElementPlan[] {
  const libelles = new Map(champsSysteme(objet).map((c) => [c.key, fr ? c.label.fr : c.label.en]));
  const dossiersObjet = dossiers.filter((d) => d.object_type === objet);
  const sectionDe = (c: ChampPerso) => dossiersObjet.find((d) => d.id === c.folder_id)?.cle_systeme ?? null;
  const rangees = rangeesFormulaire(objet);
  const places = new Set<string>();
  const plan: ElementPlan[] = [];
  const poser = (liste: ChampPerso[]) => {
    for (const c of [...liste].sort(parPosition)) { places.add(c.id); plan.push({ type: 'champ', id: `c:${c.id}`, champ: c }); }
  };

  for (const s of SECTIONS_SYSTEME[objet]) {
    const dossier = dossiersObjet.find((d) => d.cle_systeme === s.cle) ?? null;
    const siennes = rangees.filter((r) => r.section === s.cle);
    const champsSection = champs.filter((c) => sectionDe(c) === s.cle);
    if (!siennes.length && !champsSection.length) continue;
    plan.push({ type: 'entete', id: `s:${s.cle}`, dossierId: dossier?.id ?? null, section: s.cle, titre: fr ? s.nom.fr : s.nom.en });
    for (const r of siennes) {
      plan.push({ type: 'rangee', id: `r:${r.cles[0]}`, section: s.cle, cle: r.cles[0], libelle: r.cles.map((k) => libelles.get(k) ?? k).join(' · ') });
      poser(champsSection.filter((c) => ancreValide(objet, c, s.cle) === r.cles[0]));
    }
    poser(champsSection.filter((c) => !places.has(c.id)));
  }
  // Dossiers de l'entreprise, puis les champs sans dossier : en bas du formulaire.
  for (const d of dossiersObjet.filter((x) => !x.cle_systeme)) {
    plan.push({ type: 'entete', id: `d:${d.id}`, dossierId: d.id, section: null, titre: nomDossier(d, fr) });
    poser(champs.filter((c) => c.folder_id === d.id));
  }
  plan.push({ type: 'entete', id: 'd:', dossierId: null, section: null, titre: fr ? 'Champs personnalisés (bas du formulaire)' : 'Custom fields (bottom of the form)' });
  poser(champs.filter((c) => !places.has(c.id)));
  return plan;
}

export interface Place { folder_id: string | null; apres: string | null; position: number }

/**
 * Relit la place de chaque custom key dans un plan réordonné (glisser-déposer).
 * Sous l'en-tête d'une section, avant sa 1re rangée : collée à la 1re rangée
 * (le formulaire n'a pas d'emplacement au-dessus). Après la dernière rangée : fin
 * de section (`apres` null).
 */
export function lirePlan(objet: ObjetChamp, plan: ElementPlan[]): Map<string, Place> {
  const ancres = ancresFormulaire(objet);
  const premiereRangee = new Map<string, string>();
  for (const e of plan) if (e.type === 'rangee' && !premiereRangee.has(e.section)) premiereRangee.set(e.section, e.cle);
  const places = new Map<string, Place>();
  let entete = plan.find((e): e is Extract<ElementPlan, { type: 'entete' }> => e.type === 'entete') ?? null;
  let derniereRangee: string | null = null;
  let position = 0;
  for (const e of plan) {
    if (e.type === 'entete') { entete = e; derniereRangee = null; continue; }
    if (e.type === 'rangee') { derniereRangee = e.cle; continue; }
    let apres: string | null = null;
    if (entete?.section) {
      const cle = derniereRangee ?? premiereRangee.get(entete.section) ?? null;
      apres = cle && ancres.has(cle) ? cle : null;
    }
    places.set(e.champ.id, { folder_id: entete?.dossierId ?? null, apres, position: position++ });
  }
  return places;
}
