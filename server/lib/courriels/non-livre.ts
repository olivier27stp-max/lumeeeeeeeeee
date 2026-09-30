/**
 * « Courriel non livré » — la notification que reçoit l'entreprise quand un
 * de ses courriels rebondit ou fait l'objet d'une plainte.
 *
 * Partagée par les deux fournisseurs : Resend (`routes/webhooks-email.ts`)
 * et Amazon SES (`routes/webhooks-ses.ts`). Avant (audit V2, C4), seul le
 * webhook Resend prévenait l'entreprise ; or SES est LE fournisseur de la
 * prod : l'entrepreneur n'apprenait jamais qu'une facture n'était pas arrivée.
 *
 * Une ligne par propriétaire / administrateur, dans SA langue (FR/EN) ; sans
 * destinataire résolu, une ligne pour toute l'entreprise (jamais perdue).
 * Ne lève jamais.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { insertTargetedNotifications, resolveQuoteRecipients } from '../notificationHelpers';
import { logger } from '../logger';

export interface LivraisonNonLivree {
  org_id: string | null;
  to_email: string | null;
  entity_type: string | null;
  entity_id: string | null;
}

/** Le lien vers le document concerné, quand il en a un. */
export function lienDocument(entityType: string | null, entityId: string | null): string | null {
  if (!entityId) return null;
  if (entityType === 'invoice') return `/invoices/${entityId}`;
  if (entityType === 'quote') return `/quotes/${entityId}`;
  return null;
}

export function texteNonLivre(
  statut: 'bounced' | 'complained',
  adresse: string,
  detail: string | null,
  langue: 'fr' | 'en',
): { title: string; body: string } {
  const fr = langue === 'fr';
  const title = statut === 'bounced'
    ? (fr ? `Courriel non livré à ${adresse}` : `Email not delivered to ${adresse}`)
    : (fr ? `Plainte pourriel de ${adresse}` : `Spam complaint from ${adresse}`);
  const body = detail
    ? String(detail).slice(0, 300)
    : (fr ? 'Vérifiez l’adresse du client et renvoyez le document.' : 'Check the client’s address and resend the document.');
  return { title, body };
}

export async function notifierCourrielNonLivre(
  admin: SupabaseClient,
  ligne: LivraisonNonLivree,
  statut: 'bounced' | 'complained',
  detail: string | null,
): Promise<void> {
  if (!ligne.org_id) return;
  try {
    const destinataires = await resolveQuoteRecipients(admin, ligne.org_id, {});
    await insertTargetedNotifications(
      admin,
      ligne.org_id,
      destinataires,
      (langue) => texteNonLivre(statut, String(ligne.to_email ?? ''), detail, langue),
      {
        type: 'email_bounced',
        entityType: ligne.entity_type,
        entityId: ligne.entity_id,
        link: lienDocument(ligne.entity_type, ligne.entity_id),
        icon: 'alert-triangle',
      },
    );
  } catch (e: any) {
    logger.error('[courriels/non-livre] notification non créée', { orgId: ligne.org_id, error: e?.message || String(e) });
  }
}
