/**
 * Le formulaire de demande SUIT les champs personnalisés.
 *
 * Demande de Rafba (2026-09-26) : « je veux que ça se mette automatiquement une
 * fois créé, attribué au bon truc, et que le formulaire s'adapte. » Avant, créer
 * un champ ne faisait rien au formulaire : il fallait retourner dans Réglages →
 * Formulaire de demande et l'ajouter à la main, ce que personne ne devine.
 *
 * Donc :
 *   · créé   → la question est ajoutée aux formulaires de l'entreprise,
 *              déjà reliée au champ (la réponse le remplit) ;
 *   · modifié → les questions déjà reliées suivent (libellé, options, obligatoire) ;
 *   · archivé → les questions reliées disparaissent.
 *
 * Deux garde-fous :
 *   · seuls les champs CLIENT et PIPELINE peuvent y aller — un formulaire crée
 *     une demande, un client et une carte ; un champ de job ou de facture n'a
 *     rien à remplir là (et « Fichier » ne se téléverse pas depuis le public) ;
 *   · une question retirée à la main ne revient pas : on ne réécrit que ce qui
 *     est encore relié.
 *
 * Rien ici ne doit faire échouer l'écriture du champ : le formulaire est un
 * effet de bord. Les appelants encapsulent, et une erreur se journalise.
 *
 * Le `db` attendu est le CLIENT DE SERVICE : `request_forms` refuse l'écriture
 * par le client utilisateur (c'est déjà ainsi que la route des formulaires
 * procède). L'entreprise vient de la session et borne chaque requête.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { optionsQuestion, peutAllerAuFormulaire, questionPour, typeQuestion } from '../../../src/lib/champs/questionsFormulaire';
import type { ChampPerso } from '../../../src/lib/champs/types';

interface Question { id?: string; cf_field_id?: string | null; label?: string; type?: string; required?: boolean; options?: string[]; section?: string }
interface Formulaire { id: string; custom_fields: unknown }

const questions = (f: Formulaire): Question[] =>
  Array.isArray(f.custom_fields) ? (f.custom_fields as Question[]) : [];

async function formulairesDe(db: SupabaseClient, orgId: string): Promise<Formulaire[]> {
  const { data, error } = await db.from('request_forms')
    .select('id, custom_fields').eq('org_id', orgId).is('deleted_at', null);
  if (error) throw new Error(error.message);
  return (data ?? []) as Formulaire[];
}

async function ecrire(db: SupabaseClient, orgId: string, id: string, liste: Question[]): Promise<void> {
  const { error } = await db.from('request_forms')
    .update({ custom_fields: liste }).eq('id', id).eq('org_id', orgId);
  if (error) throw new Error(error.message);
}

/** Un identifiant de question au même format que celui du constructeur. */
const idQuestion = () => `field_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

/** À la création : poser la question sur chaque formulaire de l'entreprise. */
export async function ajouterAuxFormulaires(db: SupabaseClient, orgId: string, champ: ChampPerso): Promise<number> {
  if (!peutAllerAuFormulaire(champ)) return 0;
  let touches = 0;
  for (const f of await formulairesDe(db, orgId)) {
    const liste = questions(f);
    if (liste.some((q) => q.cf_field_id === champ.id)) continue; // déjà là
    await ecrire(db, orgId, f.id, [...liste, questionPour(champ, 'service_details', idQuestion()) as Question]);
    touches++;
  }
  return touches;
}

/** À la modification : les questions reliées reprennent le libellé, les options, l'obligatoire. */
export async function synchroniserQuestions(db: SupabaseClient, orgId: string, champ: ChampPerso): Promise<number> {
  let touches = 0;
  for (const f of await formulairesDe(db, orgId)) {
    const liste = questions(f);
    let change = false;
    const suite = liste.map((q) => {
      if (q.cf_field_id !== champ.id) return q;
      const neuf = {
        ...q,
        label: champ.label,
        type: typeQuestion(champ),
        required: !!champ.is_required,
        options: optionsQuestion(champ),
      };
      if (JSON.stringify(neuf) !== JSON.stringify(q)) change = true;
      return neuf;
    });
    if (!change) continue;
    await ecrire(db, orgId, f.id, suite);
    touches++;
  }
  return touches;
}

/** À l'archivage : la question disparaît du formulaire (elle ne remplirait plus rien). */
export async function retirerDesFormulaires(db: SupabaseClient, orgId: string, champId: string): Promise<number> {
  let touches = 0;
  for (const f of await formulairesDe(db, orgId)) {
    const liste = questions(f);
    const suite = liste.filter((q) => q.cf_field_id !== champId);
    if (suite.length === liste.length) continue;
    await ecrire(db, orgId, f.id, suite);
    touches++;
  }
  return touches;
}
