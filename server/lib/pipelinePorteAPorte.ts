/**
 * La carte de porte-à-porte entre dans le pipeline de ventes.
 * ===========================================================
 * Symétrique de `fieldPinSync` : celui-là va du CRM vers la carte (un devis
 * dépose un pin), celui-ci va de la carte vers le pipeline (une porte devient
 * un deal).
 *
 * LA FRONTIÈRE, et pourquoi elle est là. Les pins ont neuf statuts, mais six
 * d'entre eux — unknown, no_answer, not_interested, do_not_knock, revisit,
 * callback — sont des états de PORTE, pas des étapes de vente. Les verser dans
 * le pipeline le noierait sous des milliers de portes muettes et fausserait le
 * taux de closing : on ne « perd » pas une porte où personne n'a répondu.
 *
 * Seuls `lead`, `quote_sent` et `sale` marquent un vrai prospect. C'est là que
 * la porte entre — et elle n'en ressort plus : redescendre à « callback » ne
 * supprime pas le deal, ça reste la même personne à relancer.
 *
 * Tout le travail délicat (rapprochement par téléphone ou courriel, première
 * étape ouverte, non assigné, idempotence) vit dans la fonction SQL
 * `pipeline_ingerer_porte`, qui délègue elle-même à `ingest_lead`. Une porte
 * suit donc exactement le même chemin qu'un lead du formulaire public.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from './logger';

/** Les statuts qui font entrer une porte dans le pipeline. */
const STATUTS_PROSPECT = new Set(['lead', 'quote_sent', 'sale']);

export function porteDevientProspect(statut: string | null | undefined): boolean {
  return !!statut && STATUTS_PROSPECT.has(statut);
}

export interface ResultatIngestionPorte {
  dealId: string | null;
  clientId: string | null;
  cree: boolean;
  fusionne: boolean;
}

/**
 * Fait entrer une porte dans le pipeline, si son statut le justifie.
 *
 * Ne lève JAMAIS : cogner une porte doit réussir même si le pipeline refuse
 * l'ingestion (organisation sans pipeline, par exemple). L'échec est journalisé
 * — jamais avalé en silence — et le terrain continue de fonctionner.
 *
 * @returns le résultat, ou `null` si le statut n'est pas un statut de prospect.
 */
export async function ingererPorteDansPipeline(
  admin: SupabaseClient,
  params: { orgId: string; houseId: string; clientId?: string | null; actorId: string; statut: string },
): Promise<ResultatIngestionPorte | null> {
  if (!porteDevientProspect(params.statut)) return null;

  const { data, error } = await admin.rpc('pipeline_ingerer_porte', {
    p_org_id: params.orgId,
    p_house_id: params.houseId,
    p_client_id: params.clientId ?? null,
    p_created_by: params.actorId,
  });

  if (error) {
    logger.error('[pipeline/d2d] ingestion de la porte échouée', {
      orgId: params.orgId,
      houseId: params.houseId,
      statut: params.statut,
      message: error.message,
    });
    return null;
  }

  const res = (data ?? {}) as Record<string, unknown>;
  return {
    dealId: (res.deal_id as string) ?? null,
    clientId: (res.client_id as string) ?? null,
    cree: res.cree === true,
    fusionne: res.fusionne === true,
  };
}
