/**
 * Base légale d'un message commercial — LCAP / loi 25 (2026-09-23).
 * ─────────────────────────────────────────────────────────────────
 * La LCAP reconnaît DEUX bases légales, et le correctif du 2026-09-19 (F7)
 * n'en acceptait qu'une :
 *
 *  1. CONSENTEMENT EXPRÈS — la personne a dit oui (case cochée, formulaire
 *     signé, accord verbal noté). Il n'expire PAS : il vaut jusqu'au retrait.
 *
 *  2. CONSENTEMENT TACITE — il découle d'une relation existante :
 *       • relation d'affaires : 2 ans après un contrat, un achat, une facture ;
 *       • demande d'information : 6 mois après une demande de la personne.
 *
 * Mesuré en production le 2026-09-23 : sur 30 clients joignables, 19 avaient
 * une relation d'affaires de moins de 2 ans — donc le droit d'être contactés —
 * et TOUS étaient bloqués, faute d'un `*_consent_at` que rien ne permettait
 * de saisir. Le verrou était juste, mais plus strict que la loi.
 *
 * ── Ce que ce module ne fait PAS ──
 * Il ne décide pas seul : le retrait (désabonnement, STOP) est vérifié AVANT,
 * dans `server/lib/actions/index.ts`, et prime sur toute base légale. Un
 * consentement tacite ne survit jamais à un retrait.
 *
 * ── Pourquoi une fonction pure ──
 * Les fenêtres de 2 ans et 6 mois sont la partie du code où une erreur est à
 * la fois invisible et coûteuse. Isolées ici, elles se testent sans base de
 * données, sur des dates choisies au jour près.
 *
 * Sources : CRTC, « Guidance on Implied Consent »
 * (https://crtc.gc.ca/eng/com500/guide.htm) et l'avis d'application sur la
 * tenue des registres de consentement (2016) — la charge de la preuve
 * appartient à l'EXPÉDITEUR, d'où `reference` : sans elle, on saurait qu'on
 * avait le droit sans pouvoir le démontrer.
 *
 * Tests : tests/consentement-base-legale.test.ts
 */

/** Relation d'affaires : 2 ans après un contrat, un achat ou une facture. */
export const JOURS_RELATION_AFFAIRES = 730;
/** Demande d'information : 6 mois après une demande de la personne. */
export const JOURS_DEMANDE = 182;

const JOUR_MS = 86_400_000;

/**
 * La base qui autorise l'envoi. `reference` identifie la PREUVE (l'id du job,
 * de la facture ou du devis) : c'est ce qu'on produirait si le CRTC le
 * demandait.
 */
export type BaseLegale =
  | { type: 'expres'; depuis: string }
  | {
      type: 'tacite';
      raison: 'relation_affaires' | 'demande';
      /** Id de l'entité qui fonde la relation — la pièce justificative. */
      reference: string;
      /** Date à laquelle cette base cesse d'être valable (ISO). */
      expire: string;
    };

/** Les dates qui peuvent fonder un consentement tacite, pour UN client. */
export interface AncragesTacite {
  /** Job le plus récent (n'importe quel statut : le contrat existe). */
  dernierJob?: { id: string; date: string } | null;
  /** Facture la plus récente. */
  derniereFacture?: { id: string; date: string } | null;
  /** Devis le plus récent — une demande de prix EST une demande d'information. */
  dernierDevis?: { id: string; date: string } | null;
}

/** Date valide et située dans le passé (une date future ne fonde rien). */
function dateUtilisable(iso: string | null | undefined, maintenant: number): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t) || t > maintenant) return null;
  return t;
}

/**
 * La base tacite la plus solide, ou `null`.
 *
 * La relation d'affaires prime sur la demande : elle est plus forte et dure
 * plus longtemps. Entre un job et une facture, on retient le plus RÉCENT —
 * c'est lui qui repousse l'échéance le plus loin.
 */
export function baseTacite(
  ancrages: AncragesTacite,
  maintenant: Date = new Date(),
): BaseLegale | null {
  const now = maintenant.getTime();

  const affaires: Array<{ id: string; t: number }> = [];
  for (const a of [ancrages.dernierJob, ancrages.derniereFacture]) {
    const t = dateUtilisable(a?.date, now);
    if (a && t !== null) affaires.push({ id: a.id, t });
  }
  if (affaires.length) {
    const plusRecent = affaires.reduce((m, x) => (x.t > m.t ? x : m));
    const fin = plusRecent.t + JOURS_RELATION_AFFAIRES * JOUR_MS;
    if (fin > now) {
      return {
        type: 'tacite',
        raison: 'relation_affaires',
        reference: plusRecent.id,
        expire: new Date(fin).toISOString(),
      };
    }
  }

  const t = dateUtilisable(ancrages.dernierDevis?.date, now);
  if (ancrages.dernierDevis && t !== null) {
    const fin = t + JOURS_DEMANDE * JOUR_MS;
    if (fin > now) {
      return {
        type: 'tacite',
        raison: 'demande',
        reference: ancrages.dernierDevis.id,
        expire: new Date(fin).toISOString(),
      };
    }
  }

  return null;
}

/**
 * La base légale retenue pour un canal, l'exprès d'abord.
 *
 * L'exprès prime parce qu'il est plus fort ET plus durable : inutile de faire
 * expirer dans 2 ans quelqu'un qui a dit oui sans condition.
 */
export function baseLegalePour(
  consentiLe: string | null | undefined,
  ancrages: AncragesTacite,
  maintenant: Date = new Date(),
): BaseLegale | null {
  if (consentiLe) {
    const t = dateUtilisable(consentiLe, maintenant.getTime());
    if (t !== null) return { type: 'expres', depuis: new Date(t).toISOString() };
  }
  return baseTacite(ancrages, maintenant);
}

/** Phrase courte pour un journal ou un message d'erreur — jamais pour un client. */
export function decrireBase(base: BaseLegale): string {
  if (base.type === 'expres') return `consentement exprès du ${base.depuis.slice(0, 10)}`;
  return base.raison === 'relation_affaires'
    ? `relation d'affaires (valide jusqu'au ${base.expire.slice(0, 10)})`
    : `demande d'information (valide jusqu'au ${base.expire.slice(0, 10)})`;
}

/** Valeur écrite dans `consents.method` : elle doit dire d'où vient le droit. */
export function methodePourJournal(base: BaseLegale): string {
  return base.type === 'expres' ? 'crm-expres' : `lcap-tacite:${base.raison}`;
}
