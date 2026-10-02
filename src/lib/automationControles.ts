/* ═══════════════════════════════════════════════════════════════
   LES CONTRÔLES DE PUBLICATION QUI MANQUAIENT (mission, points 8 et 18).

   `problemesPublication` (src/lib/publicationAutomatisation.ts) dit déjà :
   déclencheur absent ou pas branché, réglage obligatoire vide, parcours sans
   étape, action inconnue / indisponible / incompatible, champ obligatoire
   vide, valeur hors bornes, texte d'exemple jamais rédigé, renvoi vers une
   étape supprimée, condition sans critère, parcours qui finit sur une attente,
   aucun message au client. RIEN de tout cela n'est refait ici.

   Ce fichier ajoute ce qu'aucun contrôle ne disait :

     BLOQUANT
       · variable inconnue, hors contexte, mal écrite, ou valeur de
         remplacement trop longue — le client lirait « Bonjour , » ou des
         crochets (`variablesInconnues`, catalogue unique) ;
       · message vide une fois la mise en forme retirée (`<p></p>`) ;
       · attente sans durée ;
       · condition dont AUCUNE branche ne mène quelque part ;
       · étape que rien n'atteint (elle ne s'exécuterait jamais) ;
       · parcours qui revient sur lui-même ;
       · message au client sur un déclencheur qui n'apporte aucun client.
     AVERTISSEMENT
       · plus de 25 étapes : suggestion douce de séparer.

   Fonctions PURES. Le branchement tient en une ligne — `enProblemes(...)` rend
   la forme `ProblemePublication` de `problemesPublication`.

   Un préréglage fourni par Lume, jamais converti, n'est pas contrôlé (même
   règle que `problemesPublication` : il tourne tel que semé).
   ═══════════════════════════════════════════════════════════════ */

import { trouverAction, type ProblemePublication } from './automationCatalogue';
import { variablesInconnues, entiteDuDeclencheur, type ChampPourVariables } from './automationVariables';
import { estFormatOrigine } from './sequenceTypes';

/** Au-delà, le parcours devient difficile à suivre : on suggère de le séparer (jamais un refus). */
export const ETAPES_AVANT_SUGGESTION = 25;

export type CodeControle =
  | 'variable_inconnue' | 'variable_hors_contexte' | 'variable_mal_ecrite' | 'remplacement_trop_long'
  | 'message_vide' | 'attente_sans_duree' | 'branche_vide' | 'etape_orpheline' | 'boucle' | 'sans_destinataire'
  | 'trop_d_etapes';

export interface Controle {
  code: CodeControle;
  fr: string;
  en: string;
  /** L'étape fautive, pour l'ouvrir d'un clic. */
  etapeId?: string;
}

export interface ControlesPublication {
  bloquants: Controle[];
  avertissements: Controle[];
}

export interface RegleAControler {
  trigger_event?: string | null;
  steps?: unknown;
  actions?: unknown;
  conditions?: Record<string, unknown> | null;
  is_preset?: boolean | null;
  /** L'entité que les réglages de la règle fixent (voir `champQuiFixeLEntite`). */
  entite?: string | null;
}

export interface OptionsControles {
  /**
   * Les champs personnalisés du bureau. Absents (`undefined`) : un champ de
   * fiche écrit à la main ne peut pas être jugé, il n'est pas signalé.
   */
  champs?: readonly ChampPourVariables[];
}

type EtapeLue = {
  id: string; type: string; nom?: string | null;
  action?: { type?: string; config?: Record<string, unknown> } | null;
  suivant?: string | null; alors?: string | null; sinon?: string | null; si_reponse?: string | null; si_depasse?: string | null;
  mode?: string | null; delai_secondes?: unknown; secondes_avant?: unknown;
};

const estObjet = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Le texte qu'un lecteur verrait : sans balises, sans entités d'espace. */
export function texteVisible(valeur: string): string {
  return valeur
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;|&#xa0;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const CODE_PAR_RAISON = {
  inconnue: 'variable_inconnue', hors_contexte: 'variable_hors_contexte', mal_ecrite: 'variable_mal_ecrite', remplacement_trop_long: 'remplacement_trop_long',
} as const;

/** Les suites d'une étape, comme le moteur les suit. */
function suites(e: EtapeLue): Array<string | null | undefined> {
  if (e.type === 'si') return [e.alors, e.sinon];
  if (e.type === 'arreter') return [];
  if (e.type === 'attendre') return [e.suivant, e.si_reponse, e.si_depasse];
  return [e.suivant];
}

/**
 * Les contrôles qui s'ajoutent à `problemesPublication`. `bloquants` : la
 * publication est refusée (et l'enregistrement d'une règle déjà publiée) ;
 * `avertissements` : à montrer, sans rien empêcher.
 */
export function controlesPublication(regle: RegleAControler, options: OptionsControles = {}): ControlesPublication {
  const bloquants: Controle[] = [];
  const avertissements: Controle[] = [];
  const steps = (Array.isArray(regle.steps) ? regle.steps : []).filter(estObjet) as unknown as EtapeLue[];
  const actions = (Array.isArray(regle.actions) ? regle.actions : []).filter(estObjet) as Array<{ type?: string; config?: Record<string, unknown> }>;
  const origine = estFormatOrigine({ steps: regle.steps, actions: regle.actions });
  // Un modèle fourni, jamais converti : il tourne tel que semé.
  if (origine && regle.is_preset) return { bloquants, avertissements };

  const declencheur = regle.trigger_event ?? null;
  const entite = entiteDuDeclencheur(declencheur, regle.entite);

  /** Comment on NOMME une étape : son nom, sinon le nom de son action et son rang. */
  const nommer = (e: EtapeLue | null, rang: number, type?: string): { fr: string; en: string } => {
    const modele = type ? trouverAction(type) : undefined;
    if (e?.nom?.trim()) return { fr: `Étape « ${e.nom.trim()} »`, en: `Step “${e.nom.trim()}”` };
    const quoi = modele ? { fr: ` (${modele.fr})`, en: ` (${modele.en})` } : { fr: '', en: '' };
    return e
      ? { fr: `Étape ${rang}${quoi.fr}`, en: `Step ${rang}${quoi.en}` }
      : { fr: `Action ${rang}${quoi.fr}`, en: `Action ${rang}${quoi.en}` };
  };

  /** Les contrôles d'une action : variables, message vide, destinataire. */
  const controlerAction = (action: { type?: string; config?: Record<string, unknown> } | null | undefined, e: EtapeLue | null, rang: number) => {
    const type = String(action?.type ?? '');
    const modele = trouverAction(type);
    if (!modele) return; // inconnue ou interne (`log_activity`) : `problemesPublication` s'en charge
    const nom = nommer(e, rang, type);
    const etapeId = e?.id;
    const config = (action?.config ?? {}) as Record<string, unknown>;

    if (modele.vers_client && entite === 'automation_webhook_receipt') {
      bloquants.push({
        code: 'sans_destinataire', etapeId,
        fr: `${nom.fr} : un appel reçu de l’extérieur n’apporte aucun client — ce message n’aurait personne à qui partir.`,
        en: `${nom.en}: an incoming webhook brings no client — this message would have no one to go to.`,
      });
    }

    for (const champ of modele.champs) {
      if (champ.type !== 'zone' && champ.type !== 'texte') continue;
      for (const [cle, langue] of [[champ.cle, null], [`${champ.cle}_en`, 'en']] as const) {
        const valeur = config[cle];
        if (typeof valeur !== 'string' || valeur === '') continue;
        const ou = langue ? { fr: `${champ.fr} (version anglaise)`, en: `${champ.en} (English version)` } : { fr: champ.fr, en: champ.en };

        // Rempli, mais rien à lire : un courriel fait de balises vides partirait blanc.
        if (champ.obligatoire && valeur.trim() !== '' && texteVisible(valeur) === '') {
          bloquants.push({
            code: 'message_vide', etapeId,
            fr: `${nom.fr} : « ${ou.fr} » ne contient que de la mise en forme — le client recevrait un message vide.`,
            en: `${nom.en}: “${ou.en}” only contains formatting — the client would get an empty message.`,
          });
        }
        for (const p of variablesInconnues(valeur, declencheur, options.champs, { entite: regle.entite })) {
          bloquants.push({ code: CODE_PAR_RAISON[p.raison], etapeId, fr: `${nom.fr} : ${p.fr}`, en: `${nom.en}: ${p.en}` });
        }
      }
    }
  };

  if (steps.length === 0) {
    // Format d'origine (ou parcours vide — `problemesPublication` le dit déjà).
    if (origine) actions.forEach((a, i) => controlerAction(a, null, i + 1));
    return { bloquants, avertissements };
  }

  const parId = new Map(steps.map((e) => [String(e.id), e]));

  // ── Ce que rien n'atteint ──
  const atteintes = new Set<string>();
  const pile = [String(steps[0].id)];
  while (pile.length) {
    const id = pile.pop() as string;
    const e = parId.get(id);
    if (!e || atteintes.has(id)) continue;
    atteintes.add(id);
    for (const s of suites(e)) if (s) pile.push(String(s));
  }

  // ── Une boucle ? (parcours en profondeur, comme `problemesDuGraphe` côté serveur) ──
  const enCours = new Set<string>();
  const finies = new Set<string>();
  const descendre = (id: string): string | null => {
    if (enCours.has(id)) return id;
    if (finies.has(id)) return null;
    const e = parId.get(id);
    if (!e) return null;
    enCours.add(id);
    for (const s of suites(e)) {
      const fautive = s ? descendre(String(s)) : null;
      if (fautive) return fautive;
    }
    enCours.delete(id);
    finies.add(id);
    return null;
  };
  const boucle = steps.map((e) => descendre(String(e.id))).find((x) => x);
  if (boucle) {
    bloquants.push({
      code: 'boucle', etapeId: boucle,
      fr: 'Le parcours revient sur lui-même : les messages partiraient en boucle. Défaites le renvoi qui ramène en arrière.',
      en: 'The journey loops back on itself: messages would be sent in a loop. Undo the link that goes backwards.',
    });
  }

  steps.forEach((e, i) => {
    const rang = i + 1;
    const id = String(e.id);
    const type = e.type === 'action' ? String(e.action?.type ?? '') : undefined;
    const nom = nommer(e, rang, type);

    if (!atteintes.has(id)) {
      bloquants.push({
        code: 'etape_orpheline', etapeId: id,
        fr: `${nom.fr} : rien ne mène à cette étape, elle ne s’exécuterait jamais. Reliez-la au parcours ou supprimez-la.`,
        en: `${nom.en}: nothing leads to this step, it would never run. Connect it to the journey or delete it.`,
      });
    }

    if (e.type === 'action') controlerAction(e.action, e, rang);

    if (e.type === 'attendre') {
      const duree = Number(e.mode === 'avant_date' ? e.secondes_avant : e.delai_secondes);
      if (!Number.isFinite(duree) || duree <= 0) {
        bloquants.push({
          code: 'attente_sans_duree', etapeId: id,
          fr: e.mode === 'avant_date'
            ? `${nom.fr} : dites combien de temps avant le rendez-vous il faut attendre.`
            : `${nom.fr} : l’attente n’a pas de durée — la suite partirait tout de suite.`,
          en: e.mode === 'avant_date'
            ? `${nom.en}: say how long before the appointment to wait.`
            : `${nom.en}: the wait has no duration — what follows would go out right away.`,
        });
      }
    }

    if (e.type === 'si' && !e.alors && !e.sinon) {
      bloquants.push({
        code: 'branche_vide', etapeId: id,
        fr: `${nom.fr} : la condition ne mène nulle part. Ajoutez une étape sous « si oui » ou « si non », ou retirez la condition.`,
        en: `${nom.en}: the condition leads nowhere. Add a step under “if yes” or “if no”, or remove the condition.`,
      });
    }
  });

  if (steps.length > ETAPES_AVANT_SUGGESTION) {
    avertissements.push({
      code: 'trop_d_etapes',
      fr: `Ce parcours compte ${steps.length} étapes. Au-delà de ${ETAPES_AVANT_SUGGESTION}, il devient difficile à suivre et à corriger : pensez à le séparer en deux automatisations.`,
      en: `This journey has ${steps.length} steps. Past ${ETAPES_AVANT_SUGGESTION}, it gets hard to follow and to fix: consider splitting it into two automations.`,
    });
  }

  return { bloquants, avertissements };
}

/**
 * Les mêmes contrôles, sous la forme de `problemesPublication` — pour s'y
 * brancher en une ligne :
 *   return [...problemesAvantPublication({ … }), ...enProblemes(regle, { champs })];
 */
export function enProblemes(regle: RegleAControler & { fr?: boolean }, options: OptionsControles = {}): ProblemePublication[] {
  const fr = regle.fr !== false;
  const { bloquants, avertissements } = controlesPublication(regle, options);
  return [
    ...bloquants.map((c): ProblemePublication => ({ message: fr ? c.fr : c.en, gravite: 'bloquant', ...(c.etapeId ? { etapeId: c.etapeId } : {}) })),
    ...avertissements.map((c): ProblemePublication => ({ message: fr ? c.fr : c.en, gravite: 'avertissement', ...(c.etapeId ? { etapeId: c.etapeId } : {}) })),
  ];
}
