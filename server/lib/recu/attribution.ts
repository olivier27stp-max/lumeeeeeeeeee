/**
 * Le Reçu — attribution des soumissions signées après un suivi.
 * ─────────────────────────────────────────────────────────────
 * Une seule question, posée honnêtement : cette soumission avait-elle besoin
 * d'une relance pour rentrer ?
 *
 * Règle (last-touch) : la DERNIÈRE relance partie avant la signature gagne le
 * crédit. Une soumission signée sans aucune relance entre l'envoi et la
 * signature n'entre PAS dans le reçu — c'est de l'argent qui serait rentré
 * tout seul, et le compter décrédibiliserait le total.
 *
 * Ce fichier ne parle pas à la base : il reçoit une chronologie déjà lue et
 * rend un verdict explicable. C'est ce qui le rend testable au cas limite près,
 * et c'est le même choix que `composerBriefing()` — aucun chiffre inventé.
 *
 * Vocabulaire de la base, à ne pas confondre avec celui des écrans :
 * un devis envoyé est `awaiting_response`, un devis signé est `approved`.
 */

/** Ce qui compte comme une relance : un message réellement parti au client. */
export type CanalRelance = 'email' | 'sms';

export interface Relance {
  /** Quand le message est parti. */
  envoyeeA: Date;
  canal: CanalRelance;
  /** `auto` = moteur d'automatisation, `manuel` = quelqu'un a cliqué. */
  origine: 'auto' | 'manuel';
  /** De quelle table vient la trace — sert à expliquer, et à déboguer. */
  source: 'automation_execution_logs' | 'quote_send_log';
  /** Identifiant de la ligne d'origine, quand on l'a. */
  refId?: string;
}

export interface ChronologieDevis {
  devisId: string;
  orgId: string;
  montantCents: number;
  /** Premier envoi au client. `null` = jamais envoyé (donc rien à attribuer). */
  envoyeA: Date | null;
  /** Passage à `approved`. `null` = pas signé. */
  signeA: Date | null;
  /** Toutes les relances connues, dans n'importe quel ordre. */
  relances: Relance[];
}

export type RaisonNonRetenu =
  | 'jamais_envoye'
  | 'non_signe'
  | 'montant_nul'
  | 'signe_avant_envoi'
  | 'aucune_relance_avant_signature';

export interface Attribution {
  devisId: string;
  orgId: string;
  montantCents: number;
  /** La relance créditée (la dernière avant la signature). */
  relanceCreditee: Relance;
  signeA: Date;
  envoyeA: Date;
  /** Nombre de relances parties entre l'envoi et la signature. */
  nbRelances: number;
  /** Délai entre la relance créditée et la signature, en jours pleins. */
  joursEntreRelanceEtSignature: number;
}

export interface NonRetenu {
  devisId: string;
  raison: RaisonNonRetenu;
}

export type Verdict =
  | ({ retenu: true } & Attribution)
  | ({ retenu: false } & NonRetenu);

/**
 * Fenêtre d'attribution par défaut, en jours.
 *
 * Au-delà, une relance n'est plus considérée comme la cause de la signature :
 * un devis relancé le 3 et signé le 28 doit beaucoup plus au hasard qu'au
 * suivi. Trente jours est un compromis courant pour un cycle de vente de
 * services résidentiels ; c'est un réglage, pas une vérité — d'où le paramètre.
 */
export const FENETRE_ATTRIBUTION_JOURS = 30;

const JOUR_MS = 86_400_000;

/**
 * Décide si une soumission entre dans le reçu.
 *
 * Volontairement strict : au moindre doute sur la chronologie (signature avant
 * l'envoi, horodatage manquant), on n'attribue pas. Un reçu qui exagère une
 * fois ne sera plus jamais cru.
 */
export function attribuer(
  chrono: ChronologieDevis,
  opts: { fenetreJours?: number } = {},
): Verdict {
  const fenetre = opts.fenetreJours ?? FENETRE_ATTRIBUTION_JOURS;
  const { devisId, orgId, montantCents, envoyeA, signeA } = chrono;

  if (!envoyeA) return { retenu: false, devisId, raison: 'jamais_envoye' };
  if (!signeA) return { retenu: false, devisId, raison: 'non_signe' };
  // Un devis à 0 $ (ou négatif, si la base a dérivé) n'a rien à dire dans un
  // reçu qui parle en dollars.
  if (montantCents <= 0) return { retenu: false, devisId, raison: 'montant_nul' };
  if (signeA < envoyeA) return { retenu: false, devisId, raison: 'signe_avant_envoi' };

  // Seules comptent les relances STRICTEMENT entre l'envoi et la signature :
  // l'envoi initial n'est pas une relance, et un message parti après la
  // signature n'a rien causé.
  const limiteBasse = envoyeA.getTime();
  const limiteHaute = signeA.getTime();
  const debutFenetre = limiteHaute - fenetre * JOUR_MS;

  const eligibles = chrono.relances
    .filter((r) => {
      const t = r.envoyeeA.getTime();
      return t > limiteBasse && t <= limiteHaute && t >= debutFenetre;
    })
    .sort((a, b) => a.envoyeeA.getTime() - b.envoyeeA.getTime());

  if (eligibles.length === 0) {
    return { retenu: false, devisId, raison: 'aucune_relance_avant_signature' };
  }

  const creditee = eligibles[eligibles.length - 1];

  return {
    retenu: true,
    devisId,
    orgId,
    montantCents,
    relanceCreditee: creditee,
    signeA,
    envoyeA,
    nbRelances: eligibles.length,
    joursEntreRelanceEtSignature: Math.floor(
      (limiteHaute - creditee.envoyeeA.getTime()) / JOUR_MS,
    ),
  };
}

export interface Recu {
  /** Somme attribuée, en cents. */
  totalCents: number;
  attributions: Attribution[];
  /** Pour comprendre pourquoi le total n'est pas plus gros. */
  ecartes: NonRetenu[];
}

/** Le reçu d'une période : ce que les suivis ont fait rentrer. */
export function composerRecu(
  chronos: ChronologieDevis[],
  opts: { fenetreJours?: number } = {},
): Recu {
  const attributions: Attribution[] = [];
  const ecartes: NonRetenu[] = [];

  for (const c of chronos) {
    const v = attribuer(c, opts);
    if (v.retenu) {
      const { retenu: _r, ...a } = v;
      attributions.push(a);
    } else {
      const { retenu: _r, ...n } = v;
      ecartes.push(n);
    }
  }

  // Du plus gros au plus petit : c'est le montant qui intéresse, pas la date.
  attributions.sort((a, b) => b.montantCents - a.montantCents);

  return {
    totalCents: attributions.reduce((s, a) => s + a.montantCents, 0),
    attributions,
    ecartes,
  };
}

/**
 * La timeline d'une attribution, en une phrase lisible par l'entrepreneur.
 *
 * On dit « signée après relance », jamais « récupérée par la relance » : la
 * relance a précédé la signature, elle ne l'a pas forcément causée. Affirmer
 * la causalité sur un devis conclu au téléphone ferait perdre confiance dans
 * le reçu entier.
 */
export function expliquer(a: Attribution, fr = true): string {
  const d = (x: Date) => x.toISOString().slice(0, 10);
  const montant = (a.montantCents / 100).toLocaleString(fr ? 'fr-CA' : 'en-CA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).replace(/[  ]/g, ' ');
  const canal = a.relanceCreditee.canal === 'sms' ? (fr ? 'texto' : 'text') : (fr ? 'courriel' : 'email');

  return fr
    ? `Envoyée le ${d(a.envoyeA)}, ${a.nbRelances} relance${a.nbRelances > 1 ? 's' : ''} (dernière par ${canal} le ${d(a.relanceCreditee.envoyeeA)}), signée le ${d(a.signeA)} — ${montant} $.`
    : `Sent ${d(a.envoyeA)}, ${a.nbRelances} follow-up${a.nbRelances > 1 ? 's' : ''} (last by ${canal} on ${d(a.relanceCreditee.envoyeeA)}), signed ${d(a.signeA)} — $${montant}.`;
}
