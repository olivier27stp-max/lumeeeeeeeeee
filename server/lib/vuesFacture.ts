/* ═══════════════════════════════════════════════════════════════
   Vues d'une FACTURE par le client — déclencheur « Facture consultée
   par le client » (drapeau `auto_consultation_documents`).

   Même mécanique que la soumission (vuesSoumission.ts, #704), réutilisée
   telle quelle : la vue se compte quand la page publique est SERVIE, jamais
   par un pixel de courriel, et ne compte PAS :
     · un membre connecté de l'entreprise, ou l'aperçu ouvert depuis l'app ;
     · les robots et scanners de liens, et une ouverture < 2 s après l'envoi ;
     · la même session dans les 30 minutes (dédoublonnage en base).
   Loi 25 : aucune IP, deux empreintes.

   Sans le drapeau, la route garde l'ancien suivi (enregistrerVueFacture,
   qui compte chaque chargement) : rien ne change.
   ═══════════════════════════════════════════════════════════════ */
import type { Request } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { eventBus } from './eventBus';
import { recordClientActivity } from './clientActivity';
import { logger } from './logger';
import { empreinte, estRobot, tropTotApresEnvoi, visiteurInterne, type IssueVue } from './vuesSoumission';

export interface FactureServie {
  id: string;
  org_id: string;
  client_id: string | null;
  invoice_number: string | null;
  total_cents: number | null;
  balance_cents: number | null;
  sent_at: string | null;
}

/**
 * Enregistre (ou écarte) l'ouverture d'une facture, prévient l'équipe à la
 * première, puis émet `invoice.viewed`. Ne lève JAMAIS : la facture doit
 * s'afficher même si le suivi échoue.
 */
export async function enregistrerOuvertureFacture(
  admin: SupabaseClient,
  req: Request,
  facture: FactureServie,
): Promise<IssueVue> {
  try {
    const ua = String(req.headers['user-agent'] ?? '');
    if (await visiteurInterne(admin, req, facture.org_id)) return 'interne';
    if (estRobot(ua)) return 'robot';
    if (tropTotApresEnvoi([facture.sent_at])) return 'trop_tot';

    const { data, error } = await admin.rpc('enregistrer_vue_facture', {
      p_invoice_id: facture.id,
      p_session_hash: empreinte(String(req.headers['x-lume-session'] ?? '')),
      p_user_agent_hash: empreinte(ua),
      p_compter: true,
    });
    if (error) {
      logger.error('[vues-facture] enregistrement refusé', { invoiceId: facture.id, message: error.message });
      return 'erreur';
    }
    const r = data as { enregistree: boolean; raison?: string; premiere?: boolean; nb_vues?: number; contact_id?: string | null };
    if (!r?.enregistree) return r?.raison === 'doublon' ? 'doublon' : 'introuvable';

    const contactId = r.contact_id ?? facture.client_id ?? null;
    if (contactId) void recordClientActivity(admin, contactId);

    // Comme avant : l'équipe est prévenue à la PREMIÈRE ouverture.
    if (r.premiere) {
      let nom = 'Client';
      if (contactId) {
        const { data: c } = await admin.from('clients').select('first_name, last_name').eq('id', contactId).is('deleted_at', null).maybeSingle();
        const complet = `${(c as any)?.first_name || ''} ${(c as any)?.last_name || ''}`.trim();
        if (complet) nom = complet;
      }
      const { error: nErr } = await admin.from('notifications').insert({
        org_id: facture.org_id,
        type: 'quote_opened',
        title: `${nom} opened invoice ${facture.invoice_number ?? ''}`.trim(),
        body: `${nom} has viewed their invoice for the first time.`,
        icon: 'eye',
        link: `/invoices/${facture.id}`,
        reference_id: facture.id,
      });
      if (nErr) logger.error('[vues-facture] notification non écrite', { invoiceId: facture.id, message: nErr.message });
    }

    await eventBus.emit('invoice.viewed', {
      orgId: facture.org_id,
      entityType: 'invoice',
      entityId: facture.id,
      relatedEntityType: contactId ? 'client' : undefined,
      relatedEntityId: contactId ?? undefined,
      metadata: {
        invoice_id: facture.id,
        invoice_number: facture.invoice_number,
        client_id: contactId,
        is_first_view: !!r.premiere,
        view_count: r.nb_vues ?? null,
        // Une première ouverture répond à « première » ET à « chaque ».
        ouverture: r.premiere ? ['premiere', 'chaque'] : ['chaque'],
        total_cents: facture.total_cents ?? 0,
        balance_cents: facture.balance_cents ?? 0,
        montant: Math.round(facture.total_cents ?? 0) / 100,
      },
    });
    return 'enregistree';
  } catch (e: unknown) {
    logger.error('[vues-facture] exception', { invoiceId: facture.id, message: e instanceof Error ? e.message : String(e) });
    return 'erreur';
  }
}
