/**
 * Formulaire de demande → champs personnalisés.
 *
 * Une question du formulaire peut porter `cf_field_id` : sa réponse est
 * alors écrite dans ce champ, sur l'opportunité créée (champ « deal ») ou
 * sur son client (champ « client »), au moment où la demande entre dans le
 * pipeline. Une réponse qui ne passe pas la validation du champ est
 * journalisée et ignorée : le visiteur ne perd JAMAIS sa demande pour ça.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ValeurChamp } from '../../../src/lib/champs/types';
import { listerChamps, ecrireValeurs } from './service';
import { logger } from '../logger';

export interface QuestionFormulaire { id: string; type: string; cf_field_id?: string | null }

/** Réponse brute du formulaire → valeur typée du champ (libellés → ids d'options). */
function convertir(reponse: unknown, champ: Awaited<ReturnType<typeof listerChamps>>['champs'][number]): ValeurChamp {
  if (reponse === null || reponse === undefined || reponse === '') return null;
  const parLibelle = (l: unknown) => champ.options.find((o) => !o.archived_at && o.label.toLowerCase() === String(l).trim().toLowerCase())?.id;
  switch (champ.field_type) {
    case 'dropdown_single': {
      const l = Array.isArray(reponse) ? reponse[0] : typeof reponse === 'boolean' ? (reponse ? 'Oui' : 'Non') : reponse;
      return parLibelle(l) ?? String(l); // un libellé inconnu sera refusé proprement par la validation
    }
    case 'dropdown_multi':
      return (Array.isArray(reponse) ? reponse : [reponse]).map((l) => parLibelle(l) ?? String(l));
    case 'monetary': {
      const n = Number(String(reponse).replace(/[\s$]/g, '').replace(',', '.'));
      return Number.isFinite(n) ? Math.round(n * 100) : String(reponse);
    }
    case 'number': {
      const n = Number(String(reponse).replace(',', '.'));
      return Number.isFinite(n) ? n : String(reponse);
    }
    default:
      if (typeof reponse === 'boolean') return reponse ? 'Oui' : 'Non';
      return Array.isArray(reponse) ? reponse.join(', ') : String(reponse);
  }
}

export async function appliquerReponsesFormulaire(
  admin: SupabaseClient, orgId: string, questions: QuestionFormulaire[], reponses: Record<string, unknown>,
  cibles: { dealId: string | null; clientId: string | null },
): Promise<{ ecrits: number; ignores: number }> {
  const liees = questions.filter((q) => q.cf_field_id && reponses[q.id] !== undefined);
  if (liees.length === 0) return { ecrits: 0, ignores: 0 };
  const { champs } = await listerChamps(admin, orgId, { ids: liees.map((q) => q.cf_field_id as string) });
  let ecrits = 0;
  let ignores = 0;
  for (const objet of ['deal', 'client'] as const) {
    const entite = objet === 'deal' ? cibles.dealId : cibles.clientId;
    const ecritures = liees
      .map((q) => ({ q, champ: champs.find((c) => c.id === q.cf_field_id && c.object_type === objet) }))
      .filter((x): x is { q: QuestionFormulaire; champ: (typeof champs)[number] } => !!x.champ)
      .map(({ q, champ }) => ({ field_id: champ.id, value: convertir(reponses[q.id], champ) }));
    if (!entite || ecritures.length === 0) { ignores += entite ? 0 : ecritures.length; continue; }
    const resultats = await ecrireValeurs(admin, orgId, objet, entite, ecritures, { source: 'form' });
    for (const r of resultats) {
      if (r.ok) ecrits++;
      else {
        ignores++;
        logger.warn('[champs] réponse de formulaire ignorée', { org_id: orgId, field_id: r.field_id, raison: r.erreur });
      }
    }
  }
  return { ecrits, ignores };
}
