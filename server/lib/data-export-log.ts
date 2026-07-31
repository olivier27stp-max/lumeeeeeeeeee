/**
 * N7.7 — Journalisation des exports de données personnelles.
 *
 * « La RLS empêche l'accès, elle ne le journalise pas. Sans lecture journalisée,
 *   la réponse honnête après un incident est "je ne peux pas savoir qui a lu
 *   quoi" — la pire phrase possible dans une notification à la CAI. »
 *
 * La table `data_export_log` et son écran de consultation
 * (GET /api/security/export-log) existaient déjà, mais RIEN ne les alimentait :
 * 0 ligne en production alors que six endpoints exportent des renseignements
 * personnels. Ce module centralise l'écriture pour qu'un nouvel export n'ait
 * plus d'excuse pour l'oublier.
 *
 * Volontairement NON BLOQUANT : un échec de journalisation ne doit jamais
 * priver un utilisateur de son export — en particulier pour les exports DSR,
 * qui répondent à une obligation légale de 30 jours (Loi 25 art. 27).
 * L'échec est journalisé côté serveur pour être vu en supervision.
 */
import { getServiceClient } from './supabase';

/**
 * Nature de l'export, pour pouvoir répondre « qui a exporté quoi, et pourquoi »
 * sans avoir à relire le code six mois plus tard.
 */
export type ExportType =
  | 'dsr_portability'   // droit à la portabilité (Loi 25 art. 27 / RGPD art. 20)
  | 'marketing_list'    // liste de diffusion vers un tiers (Mailchimp…)
  | 'accounting'        // export comptable (QuickBooks…)
  | 'payouts'           // versements fournisseur de paiement
  | 'payroll';          // paie

export interface DataExportLogParams {
  orgId: string;
  userId: string;
  exportType: ExportType;
  /** Entité dominante exportée : 'client', 'invoice', 'payment'… */
  entityType: string;
  /** Nombre de lignes réellement sorties — c'est la mesure de l'ampleur. */
  recordCount: number;
  req: any;
}

function clientIp(req: any): string | null {
  const fwd = req?.headers?.['x-forwarded-for'];
  if (typeof fwd === 'string') return fwd.split(',')[0]?.trim() || null;
  return req?.ip || req?.socket?.remoteAddress || null;
}

export async function logDataExport(params: DataExportLogParams): Promise<void> {
  try {
    // On LIT `error`. supabase-js ne lève pas : il renvoie { data, error }.
    // Le try/catch seul n'attrapait donc rien, et un refus RLS ou une colonne
    // manquante partait au néant — ce qui peut expliquer que cette table soit
    // restée vide alors que la fonctionnalité était déployée (audit 2026-07-31).
    const { error } = await (getServiceClient() as any).from('data_export_log').insert({
      org_id: params.orgId,
      user_id: params.userId,
      export_type: params.exportType,
      entity_type: params.entityType,
      record_count: params.recordCount,
      ip_address: clientIp(params.req),
      user_agent: String(params.req?.headers?.['user-agent'] || '').slice(0, 500) || null,
      // Permet de rattacher un fichier retrouvé « dans la nature » à un export
      // précis : qui l'a demandé, et quand.
      watermark: `${params.userId}:${Date.now()}`,
    });
    if (error) {
      // Journaliser sans lever : la traçabilité ne doit jamais faire échouer
      // l'export lui-même. Mais l'échec doit être VISIBLE.
      console.error('[data-export-log] insert refusé:', error.message, error.code || '');
    }
  } catch (err) {
    console.error('[data-export-log] insert failed:', err);
  }
}
