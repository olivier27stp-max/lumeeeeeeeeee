/**
 * Le même Lumi dans le portail de migration.
 *
 * Quand le client écrit dans « Messages avec l'équipe Lume », c'est le
 * cerveau de support (support/ia.ts) qui répond en premier, avec le dossier
 * du client et le statut de sa migration. La conversation vit dans un ticket
 * de support (source 'migration_portal', migration_id) : mêmes transferts à
 * l'équipe dans Slack, même mémoire que le chat de l'app. Chaque réponse est
 * aussi copiée dans migration_messages (ce que le portail affiche).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { repondreSupportIA, isSupportIAConfigured } from './ia';
import { PLAFOND_MODELE_PAR_JOUR, reponsesModeleAujourdhui } from './garde-fous';
import { dossierClient } from './dossier';
import { statutMigrationPour } from './migration-outils';
import { contexteOrg, creerTicket, ajouterMessage, messagesDuTicket, escaladerTicket, relayerMessageClient, slaTexte, type Ticket } from './tickets';
import type { MigrationRow } from '../migration/types';
import { journaliserTrace } from '../lumi/traces';
import { logger } from '../logger';

/** Ticket ouvert (non fermé) rattaché à cette migration, sinon null. */
export async function ticketDuPortail(admin: SupabaseClient, migration: Pick<MigrationRow, 'id' | 'org_id'>): Promise<Ticket | null> {
  const { data } = await admin.from('support_tickets').select('*').eq('migration_id', migration.id).eq('org_id', migration.org_id).neq('status', 'closed').order('last_message_at', { ascending: false }).limit(1).maybeSingle();
  return (data as Ticket) || null;
}

/**
 * Un message du client dans le portail → réponse de l'assistant (texte) ou
 * null si la conversation est déjà chez un humain (le message est relayé
 * dans le fil Slack). Ne lève jamais : en cas d'erreur, l'équipe est prévenue.
 */
export async function repondreDansLePortail(admin: SupabaseClient, migration: MigrationRow, user: { id: string; email?: string; user_metadata?: Record<string, any> }, body: string): Promise<{ texte: string | null; transferer: boolean }> {
  const debut = Date.now();
  const ctx = await contexteOrg(admin, migration.org_id, user);
  let ticket = await ticketDuPortail(admin, migration);
  if (!ticket) {
    ticket = await creerTicket(admin, { orgId: migration.org_id, userId: user.id, subject: `Migration ${migration.source_crm} — ${body.split('\n')[0].slice(0, 80)}`, category: 'migration', ctx, status: 'ai', source: 'migration_portal', migrationId: migration.id });
  }
  await ajouterMessage(admin, { ticket, author: 'user', body, authorName: ctx.userName });

  if (ticket.status === 'open' || ticket.status === 'answered') {
    await relayerMessageClient(admin, ticket, ctx, body);
    return { texte: null, transferer: true };
  }
  let texte: string | null = null;
  let transferer = false;
  let motif = '';
  // Règle stricte : même plafond par entreprise et par jour que le chat support
  // de l'app ; au-delà, l'équipe prend le relais (0 token), jamais le modèle.
  const auPlafond = isSupportIAConfigured() && (await reponsesModeleAujourdhui(admin, migration.org_id)) >= PLAFOND_MODELE_PAR_JOUR;
  if (isSupportIAConfigured() && !auPlafond) {
    try {
      const historique = (await messagesDuTicket(admin, ticket.id))
        .filter((m) => m.author === 'user' || m.author === 'ai')
        .slice(0, -1)
        .map((m) => ({ role: m.author === 'user' ? 'user' as const : 'assistant' as const, content: m.body }));
      const dossier = await dossierClient(admin, migration.org_id, user.id);
      const r = await repondreSupportIA(
        { langue: ctx.langue, companyName: ctx.companyName, planLabel: ctx.planLabel, userName: ctx.userName, slaTexte: slaTexte(ctx.slaKey, ctx.langue), surface: 'migration_portal', dossier: dossier.texte },
        historique, body,
        { statutMigration: () => statutMigrationPour(admin, migration.org_id, migration.id) },
      );
      texte = r.texte;
      transferer = r.transferer;
      motif = r.motif || '';
      await ajouterMessage(admin, { ticket, author: 'ai', body: texte, authorName: 'Lumi' });
      void journaliserTrace(admin, { orgId: migration.org_id, userId: user.id, canal: 'support', origine: 'texte', enonce: body, etage: 6, action: 'migration_portal', outils: r.outils, resultat: transferer ? 'proposition' : 'ok', model: 'claude-sonnet-5', costCents: r.coutCents, dureeMs: Date.now() - debut });
    } catch (e: any) {
      logger.error('[support/portail] assistant en erreur, transfert humain', { error: e?.message, migrationId: migration.id });
      transferer = true;
      motif = 'Assistant indisponible';
    }
  } else {
    transferer = true;
    motif = auPlafond ? 'Plafond du jour atteint' : 'Assistant non configuré';
  }
  if (transferer) {
    const r = await escaladerTicket(admin, ticket, ctx, motif || 'Transféré');
    ticket = r.ticket;
    if (!texte) texte = ctx.langue === 'fr' ? 'Je transmets votre message à notre équipe, qui vous répond ici.' : 'I am passing your message to our team, who will reply here.';
  }
  return { texte, transferer };
}
