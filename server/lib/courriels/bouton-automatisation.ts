/* ═══════════════════════════════════════════════════════════════
   Le bouton d'un courriel d'automatisation.

   Les 26 relances automatiques partaient SANS bouton : toutes demandaient de
   « répondre à ce courriel ». Une relance de soumission sans bouton
   « Accepter » oblige le client à écrire un message au lieu de cliquer une
   fois — et la plupart n'écrivent jamais.

   Ici, on retrouve la page publique de l'entité concernée (soumission,
   facture, contrat) et on en fait un bouton. Sans page publique, pas de
   bouton : mieux vaut aucun bouton qu'un lien mort.

   Ce qui se passe quand ce module ne trouve rien : le courriel part comme
   avant. Aucune automatisation ne peut être cassée par ce chemin.
   ═══════════════════════════════════════════════════════════════ */
import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../logger';
import { resolvePublicBaseUrl } from '../helpers';

export type LangueBouton = 'fr' | 'en';

export interface BoutonCourriel {
  texte: string;
  url: string;
}

/**
 * Où vit la page publique de chaque entité, et ce que le bouton doit dire.
 *
 * Les chemins viennent de `CHEMINS_PUBLICS` (src/lib/mobileGate.ts) : ce sont
 * ceux que l'application sert réellement. Un chemin inventé ici enverrait le
 * client sur une page blanche.
 */
const PAGES: Record<string, {
  table: string;
  chemin: string;
  texte: { fr: string; en: string };
  /**
   * Le libellé selon l'état du document : le bouton dit la VRAIE prochaine
   * action. « Payer la facture » sous « Paiement reçu, merci » ou « Approuver
   * la soumission » sous « Merci d'avoir accepté » (audit des courriels du
   * 2026-09-29) démentaient le message. `null` = pas de bouton du tout.
   */
  selonStatut?: Record<string, { fr: string; en: string } | null>;
}> = {
  quote: {
    table: 'quotes',
    chemin: 'quote',
    texte: { fr: 'Approuver la soumission', en: 'Approve quote' },
    selonStatut: Object.fromEntries(
      ['draft', 'approved', 'converted', 'declined', 'expired', 'archived']
        .map((s) => [s, { fr: 'Voir la soumission', en: 'View quote' }]),
    ),
  },
  invoice: {
    table: 'invoices',
    chemin: 'invoice',
    texte: { fr: 'Payer la facture', en: 'Pay invoice' },
    selonStatut: {
      paid: { fr: 'Voir le reçu', en: 'View receipt' },
      // Après un dépôt : « Payer » sous « Dépôt reçu, merci » sonnerait faux,
      // et la page de la facture porte de toute façon le bouton de paiement.
      partial: { fr: 'Voir la facture', en: 'View invoice' },
      void: null, // facture annulée : rien à payer ni à voir
    },
  },
};

/**
 * L'adresse publique de l'app.
 *
 * `resolvePublicBaseUrl` LÈVE quand rien n'est configuré — c'est voulu pour
 * une route, qui doit alors échouer bruyamment. Ici c'est différent : un
 * courriel d'automatisation doit partir même sans bouton, donc on retombe sur
 * `null` et le message est envoyé comme avant.
 */
function baseUrl(): string {
  try {
    return resolvePublicBaseUrl();
  } catch {
    return '';
  }
}

/**
 * Le bouton à poser sur un courriel d'automatisation, ou `null`.
 *
 * `null` dans tous les cas douteux : entité sans page publique, jeton absent,
 * adresse publique non configurée, lecture en échec. Un courriel sans bouton
 * reste utile ; un bouton qui mène nulle part détruit la confiance.
 */
export async function boutonPourEntite(
  db: SupabaseClient,
  orgId: string,
  entityType: string,
  entityId: string,
  langue: LangueBouton = 'fr',
): Promise<BoutonCourriel | null> {
  const page = PAGES[entityType];
  if (!page || !entityId || !orgId) return null;

  const base = baseUrl();
  if (!base) return null;

  try {
    const { data, error } = await db
      .from(page.table)
      .select('view_token, status')
      .eq('id', entityId)
      .eq('org_id', orgId) // garde-fou tenant : jamais l'entité d'une autre org
      .maybeSingle();

    if (error) {
      logger.warn('[courriels/bouton] lecture impossible, courriel sans bouton', {
        orgId, entityType, error: error.message,
      });
      return null;
    }

    const jeton = data?.view_token;
    if (!jeton) return null;

    const statut = String((data as { status?: string | null }).status || '');
    const texte = page.selonStatut && statut in page.selonStatut ? page.selonStatut[statut] : page.texte;
    if (!texte) return null;

    return {
      texte: texte[langue],
      url: `${base}/${page.chemin}/${jeton}`,
    };
  } catch (err: unknown) {
    logger.warn('[courriels/bouton] échec, courriel sans bouton', {
      orgId, entityType, error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Les types d'entité qui savent produire un bouton — utile aux tests. */
export const TYPES_AVEC_BOUTON = Object.keys(PAGES);
