/* ═══════════════════════════════════════════════════════════════
   « TESTER AVEC UN CLIENT » — la simulation, étape par étape.

   Le propriétaire choisit un client ; on lui montre ce que l'automatisation
   ferait POUR LUI : est-il ciblé, par quelles étapes passerait-il, le message
   exact qu'il lirait (ses vraies valeurs, la mention STOP, le nombre de SMS),
   et pourquoi une étape serait ignorée (pas de téléphone, STOP, désabonné,
   « aucune demande d'avis »).

   C'EST UNE LECTURE. Aucune action n'est exécutée : ni texto, ni courriel, ni
   étiquette posée, ni tâche créée, ni ligne de journal. Ce module n'appelle
   jamais `executeAction` et n'écrit dans aucune table — un test le vérifie
   (tests/automations-finale/p/essai.test.ts).

   CE QUI EST EXACT, parce que ce sont les fonctions du moteur :
     · les variables (`resolveEntityVariables`), le rendu (`resolveTemplate`,
       `sansPrenomVide`), la mention commerciale d'un texto (`typeEnvoi`,
       `avecMentionCommerciale`), le ciblage (`ciblageOk`), les conditions sur
       les champs et les étiquettes d'une étape « si » ;
   CE QUI NE L'EST PAS ENCORE (dit dans `avertissements`, jamais passé sous
   silence) : une condition « si » sur l'ÉTAT de la fiche (statut du devis…)
   se juge avec `metadonneesFraiches`, que le moteur n'exporte pas — sans elle
   la condition est « non jugée » et les DEUX branches sont montrées ; le
   consentement commercial, le plafond de fréquence, les heures d'envoi et les
   doublons ne sont pas rejoués. Voir notes/P-branchements.md (« moteur »).

   LA FICHE. Une automatisation de facture a besoin d'une facture : on prend la
   plus récente du client (devis, job, rendez-vous, opportunité de même). S'il
   n'en a pas, l'essai se fait sur sa fiche client et le dit.
   ═══════════════════════════════════════════════════════════════ */

import type { SupabaseClient } from '@supabase/supabase-js';
import { ENTITE_PAR_DECLENCHEUR, trouverAction, trouverDeclencheur } from '../../src/lib/automationCatalogue';
import { estDemandeDAvis } from '../../src/lib/automationCiblage';
import { analyserJetons } from '../../src/lib/automationVariables';
import { htmlVersTexte } from '../../src/lib/emailBodyText';
import { segmentsSms } from '../../src/lib/smsSegments';
import type { Etape } from '../../src/lib/sequenceTypes';
import type { EtapeEssai, ResultatEssai, SurLeChemin } from '../../src/lib/automationEssai';
import { resolveEntityVariables, resolveTemplate, sansPrenomVide } from './actions';
import { ciblageOk, nomDuClient } from './automations-ciblage';
import { etapesDeLaRegle, dureeEnClair, type RegleLue } from './automations-etapes';
import { conditionsChampsOk, CLE_CONDITIONS_CHAMPS } from './champs/automatisations';
import { conditionsEtiquettesOk } from './etiquettes';
import { typeEnvoi, motifSaut } from './desabonnement';
import { avecMentionCommerciale } from './desabonnement/mention-sms';
import { isEmailUnsubscribed } from './notificationHelpers';
import { clientRefuseAvis, MOTIF_CLIENT_SANS_AVIS } from './reviewOptOut';
import { normalizeE164 } from './helpers';
import { logger } from './logger';

export interface RegleAEssayer extends RegleLue {
  preset_key?: string | null;
}

export interface OptionsEssai {
  /** Le client de l'UTILISATEUR (RLS) : c'est avec lui qu'on lit le client choisi et sa fiche. */
  lecture: SupabaseClient;
  /** Le rôle de service : variables et ciblage, comme le moteur. */
  admin: SupabaseClient;
  orgId: string;
  regle: RegleAEssayer;
  clientId: string;
  fr: boolean;
  /**
   * L'état ACTUEL de la fiche, tel que le moteur le relit avant une étape
   * « si » (`metadonneesFraiches`). Absent : une condition sur cet état n'est
   * pas jugée, et les deux branches sont montrées.
   */
  etatDeLaFiche?: (entityType: string, entityId: string) => Promise<Record<string, unknown>>;
  /** L'évaluateur du moteur pour ces conditions (`evaluateConditions`), fourni avec `etatDeLaFiche`. */
  evaluerEtat?: (conditions: Record<string, unknown>, metadonnees: Record<string, unknown>) => boolean;
}

type Lecture<T> = { data: T | null; error: { message: string } | null };

/** La fiche la plus récente du client pour l'entité que le déclencheur fait arriver. */
async function ficheDuClient(
  db: SupabaseClient, orgId: string, clientId: string, entite: string, fr: boolean,
): Promise<{ type: string; id: string; libelle: string } | null> {
  const une = async (table: string, colonnes: string, filtre: (q: any) => any, tri = 'created_at') => {
    const { data, error } = await filtre(db.from(table).select(colonnes).eq('org_id', orgId).is('deleted_at', null))
      .order(tri, { ascending: false }).limit(1) as Lecture<Array<Record<string, unknown>>>;
    if (error) throw new Error(`${table} : ${error.message}`);
    return (data ?? [])[0] ?? null;
  };
  const texte = (v: unknown) => (v === null || v === undefined ? '' : String(v));
  switch (entite) {
    case 'invoice': {
      const f = await une('invoices', 'id, invoice_number', (q) => q.eq('client_id', clientId));
      return f ? { type: 'invoice', id: texte(f.id), libelle: fr ? `Facture ${texte(f.invoice_number)}` : `Invoice ${texte(f.invoice_number)}` } : null;
    }
    case 'quote': {
      const d = await une('quotes', 'id, quote_number', (q) => q.or(`client_id.eq.${clientId},lead_id.eq.${clientId}`));
      return d ? { type: 'quote', id: texte(d.id), libelle: fr ? `Devis ${texte(d.quote_number)}` : `Quote ${texte(d.quote_number)}` } : null;
    }
    case 'job': {
      const j = await une('jobs', 'id, title', (q) => q.eq('client_id', clientId));
      return j ? { type: 'job', id: texte(j.id), libelle: fr ? `Job « ${texte(j.title)} »` : `Job “${texte(j.title)}”` } : null;
    }
    case 'deal': {
      const o = await une('deals', 'id, title', (q) => q.eq('client_id', clientId));
      return o ? { type: 'deal', id: texte(o.id), libelle: fr ? `Opportunité « ${texte(o.title)} »` : `Deal “${texte(o.title)}”` } : null;
    }
    case 'schedule_event': {
      const { data: jobs, error } = await db.from('jobs').select('id').eq('org_id', orgId).eq('client_id', clientId).is('deleted_at', null).limit(200);
      if (error) throw new Error(`jobs : ${error.message}`);
      const ids = ((jobs ?? []) as Array<{ id: string }>).map((j) => j.id);
      if (ids.length === 0) return null;
      const r = await une('schedule_events', 'id, title, start_at', (q) => q.in('job_id', ids), 'start_at');
      return r ? { type: 'schedule_event', id: texte(r.id), libelle: fr ? `Rendez-vous « ${texte(r.title)} »` : `Appointment “${texte(r.title)}”` } : null;
    }
    default:
      return null;
  }
}

const NOM_FICHE: Record<string, [string, string]> = {
  invoice: ['aucune facture', 'no invoice'], quote: ['aucun devis', 'no quote'], job: ['aucun job', 'no job'],
  deal: ['aucune opportunité', 'no deal'], schedule_event: ['aucun rendez-vous', 'no appointment'],
};

/** Le texte localisé d'un champ, comme le moteur (`champLocalise`) : la version anglaise si le bureau envoie en anglais ET qu'elle existe. */
function champLocalise(config: Record<string, unknown>, champ: string, langue: 'fr' | 'en'): string {
  const en = config[`${champ}_en`];
  if (langue === 'en' && typeof en === 'string' && en.trim()) return en;
  const v = config[champ];
  return typeof v === 'string' ? v : '';
}

/** Les variables d'un gabarit qui n'ont AUCUNE valeur pour ce client (et pas de valeur de remplacement). */
function variablesVides(gabarit: string, vars: Record<string, string>): string[] {
  const lire = (cle: string) => (Object.prototype.hasOwnProperty.call(vars, cle) ? vars[cle] : undefined);
  const vides = analyserJetons(gabarit).filter((j) => {
    if (j.remplacement) return false;
    const [objet, cle] = j.pointee ? j.cle.split('.') : [null, j.cle];
    return !(objet ? (lire(j.cle) ?? lire(`${objet}_cf_${cle}`)) : lire(j.cle));
  });
  return [...new Set(vides.map((j) => j.brut))];
}

/**
 * L'essai. Rend `null` quand le client n'est pas visible de l'utilisateur
 * (inconnu, d'un autre bureau, supprimé, ou hors de sa portée).
 */
export async function essaiPourUnClient(o: OptionsEssai): Promise<ResultatEssai | null> {
  const { lecture, admin, orgId, regle, clientId, fr } = o;
  const dire = (f: string, e: string) => (fr ? f : e);
  const avertissements: string[] = [];

  // 1. Le client, lu avec la session de l'utilisateur : ce qu'il n'a pas le droit de voir n'existe pas.
  const { data: client, error: errClient } = await lecture.from('clients')
    .select('id, first_name, last_name, company, display_as_company, phone, email')
    .eq('id', clientId).eq('org_id', orgId).is('deleted_at', null).maybeSingle();
  if (errClient) throw new Error(`clients : ${errClient.message}`);
  if (!client) return null;
  const fiche0 = client as { id: string; first_name: string | null; last_name: string | null; company: string | null; display_as_company: boolean | null; phone: string | null; email: string | null };
  const nom = nomDuClient({ ...fiche0, display_as_company: fiche0.display_as_company === true }, fr);

  // 2. La fiche que le déclencheur fait arriver.
  const declencheur = regle.trigger_event ?? '';
  const entiteBrute = ENTITE_PAR_DECLENCHEUR[declencheur];
  const entite = !entiteBrute || entiteBrute === '*' || entiteBrute === 'lead' ? 'client' : entiteBrute;
  let fiche: ResultatEssai['fiche'] = null;
  let entityType = 'client';
  let entityId = clientId;
  if (entite === 'automation_webhook_receipt') {
    avertissements.push(dire(
      'Ce déclencheur (un appel reçu de l’extérieur) n’apporte aucun client : un message au client n’aurait personne à qui partir.',
      'This trigger (an incoming webhook) brings no client: a message to the client would have no one to go to.',
    ));
  } else if (entite !== 'client') {
    fiche = await ficheDuClient(lecture, orgId, clientId, entite, fr);
    if (fiche) {
      entityType = fiche.type;
      entityId = fiche.id;
    } else {
      const quoi = NOM_FICHE[entite] ?? ['aucune fiche de ce type', 'no record of this kind'];
      avertissements.push(dire(
        `${nom} n’a ${quoi[0]} : l’essai se fait sur sa fiche client, et les champs propres à ce déclencheur seront vides.`,
        `${nom} has ${quoi[1]}: the test runs on the client record, and the fields specific to this trigger will be empty.`,
      ));
    }
  }

  // 3. Les variables, la langue d'envoi et le ciblage — comme le moteur.
  const vars = await resolveEntityVariables(admin, orgId, entityType, entityId);
  const { data: reglages } = await admin.from('company_settings').select('default_language').eq('org_id', orgId).maybeSingle();
  const langue: 'fr' | 'en' = (reglages as { default_language?: string } | null)?.default_language === 'en' ? 'en' : 'fr';
  const verdict = await ciblageOk(admin, orgId, entityType, entityId, (regle.conditions ?? null) as Record<string, unknown> | null, { fr });

  // 4. Ce qui empêcherait CE client de recevoir (lectures seules).
  const telephone = (vars.client_phone ?? '').trim();
  const courriel = (vars.client_email ?? '').trim();
  let stop = false;
  if (telephone) {
    const { data: retrait, error } = await admin.from('sms_opt_outs').select('id').eq('org_id', orgId).eq('phone', normalizeE164(telephone)).limit(1);
    if (error) logger.error('[automations-essai] STOP illisible', { orgId, message: error.message });
    stop = (retrait ?? []).length > 0;
  }
  const desabonne = courriel ? await isEmailUnsubscribed(admin, orgId, courriel) : false;
  let sansAvis = false;
  try {
    sansAvis = await clientRefuseAvis(admin, orgId, clientId);
  } catch (err) {
    logger.error('[automations-essai] champ « aucune demande d’avis » illisible', { orgId, message: err instanceof Error ? err.message : String(err) });
  }

  // 5. Le parcours.
  const etapes = etapesDeLaRegle(regle);
  // Comme le moteur : une étape de parcours est planifiée, elle compte comme différée (délai d'au moins 1 s).
  const delaiPourLeType = Array.isArray(regle.steps) && regle.steps.length > 0
    ? Math.max(1, Number(regle.delay_seconds ?? 0)) : Number(regle.delay_seconds ?? 0);
  const parId = new Map(etapes.map((e) => [String(e.id), e]));
  const chemin = new Map<string, SurLeChemin>();
  const branches = new Map<string, 'alors' | 'sinon'>();
  const nonJugees = new Set<string>();

  /** Une étape « si » : jugée quand on le peut, sinon `null`. */
  const jugerSi = async (e: Extract<Etape, { type: 'si' }>): Promise<boolean | null> => {
    const conditions = (e.conditions ?? {}) as Record<string, unknown>;
    const { [CLE_CONDITIONS_CHAMPS]: champs, client_a_etiquette: _a, client_sans_etiquette: _s, ...etat } = conditions;
    if (!(await conditionsChampsOk(admin, orgId, entityType, entityId, champs))) return false;
    if (!(await conditionsEtiquettesOk(admin, async () => clientId, conditions))) return false;
    if (Object.keys(etat).length === 0) return true;
    if (!o.etatDeLaFiche || !o.evaluerEtat) return null;
    return o.evaluerEtat(etat, await o.etatDeLaFiche(entityType, entityId));
  };

  /** Marque le chemin à partir d'une étape. `certain` : ce client y passe à coup sûr. */
  const suivre = async (id: string | null | undefined, certitude: SurLeChemin): Promise<void> => {
    let courant = id ? parId.get(String(id)) : undefined;
    while (courant) {
      const cle = String(courant.id);
      const deja = chemin.get(cle);
      // Déjà marquée au moins aussi sûrement (boucle, ou deux branches qui se rejoignent) : on s'arrête.
      if (deja === 'oui' || deja === certitude) return;
      chemin.set(cle, certitude);
      if (courant.type === 'arreter') return;
      if (courant.type === 'si') {
        const v = await jugerSi(courant);
        if (v === null) {
          nonJugees.add(cle);
          await suivre(courant.alors, 'peut_etre');
          await suivre(courant.sinon, 'peut_etre');
          return;
        }
        branches.set(cle, v ? 'alors' : 'sinon');
        // La branche NON prise reste montrée (« non ») : rien à marquer, c'est le défaut.
        courant = parId.get(String((v ? courant.alors : courant.sinon) ?? ''));
        continue;
      }
      courant = parId.get(String(courant.suivant ?? ''));
    }
  };
  if (etapes[0]) await suivre(String(etapes[0].id), 'oui');

  const sortie: EtapeEssai[] = etapes.map((e, i) => {
    const base = { etape_id: String(e.id), rang: i + 1, sur_le_chemin: chemin.get(String(e.id)) ?? ('non' as SurLeChemin) };
    if (e.type === 'arreter') return { ...base, libelle: dire('Arrêter le parcours', 'Stop the journey'), issue: 'fin' };
    if (e.type === 'attendre') {
      const libelle = e.mode === 'avant_date'
        ? dire(`Attendre jusqu’à ${dureeEnClair(Number(e.secondes_avant ?? 0), true)} avant le rendez-vous`, `Wait until ${dureeEnClair(Number(e.secondes_avant ?? 0), false)} before the appointment`)
        : e.mode === 'reponse'
          ? dire(`Attendre la réponse du client, au plus ${dureeEnClair(e.delai_secondes, true)}`, `Wait for the client’s reply, at most ${dureeEnClair(e.delai_secondes, false)}`)
          : `${dire('Attendre', 'Wait')} ${dureeEnClair(e.delai_secondes, fr)}`;
      return {
        ...base, libelle, issue: 'attente',
        ...(e.mode === 'reponse' ? { raison: dire('L’essai suppose que le client ne répond pas.', 'The test assumes the client does not reply.') } : {}),
      };
    }
    if (e.type === 'si') {
      const branche = branches.get(String(e.id));
      return {
        ...base, libelle: dire('Condition', 'Condition'), issue: 'condition',
        ...(branche ? { branche } : {}),
        raison: branche
          ? (branche === 'alors' ? dire('Remplie pour ce client : branche « si oui ».', 'Met for this client: “if yes” branch.') : dire('Pas remplie pour ce client : branche « si non ».', 'Not met for this client: “if no” branch.'))
          : dire('Cette condition porte sur l’état de la fiche : l’essai ne la juge pas, les deux branches sont montrées.', 'This condition depends on the record’s state: the test does not judge it, both branches are shown.'),
      };
    }

    // Une action.
    const type = String(e.action?.type ?? '');
    const config = (e.action?.config ?? {}) as Record<string, unknown>;
    const modele = trouverAction(type);
    const libelle = e.nom?.trim()
      ? `${modele ? dire(modele.fr, modele.en) : dire('Action', 'Action')} — ${e.nom.trim()}`
      : modele ? dire(modele.fr, modele.en) : type === 'log_activity' ? dire('Note dans l’historique du client', 'Note in the client history') : dire('Une action qui n’est plus offerte', 'An action that is no longer offered');
    const ignoree = (raison: string): EtapeEssai => ({ ...base, libelle, issue: 'ignoree', raison });
    const avis = estDemandeDAvis(regle, { type, config });

    if (type === 'send_sms') {
      const gabarit = champLocalise(config, 'body', langue);
      let texte = sansPrenomVide(resolveTemplate(gabarit, vars), { texto: true });
      const marketing = typeEnvoi({ actionType: type, config, declencheur, delaiSecondes: delaiPourLeType, presetKey: regle.preset_key ?? null }) === 'marketing';
      if (marketing) texte = avecMentionCommerciale(texte, vars.company_name, langue);
      const rendu = { canal: 'sms' as const, destinataire: telephone || null, texte, sms: segmentsSms(texte).segments };
      const vides = variablesVides(gabarit, vars);
      const commun = { ...base, libelle, rendu, ...(vides.length ? { variables_vides: vides } : {}) };
      if (!telephone) return { ...commun, issue: 'ignoree', raison: dire('Aucun numéro de téléphone pour ce client', 'No phone number for this client') };
      if (stop) return { ...commun, issue: 'ignoree', raison: fr ? motifSaut('texto') : 'Client unsubscribed (text)' };
      if (avis && sansAvis) return { ...commun, issue: 'ignoree', raison: fr ? MOTIF_CLIENT_SANS_AVIS : 'Client marked “no review requests”' };
      return { ...commun, issue: 'partirait' };
    }
    if (type === 'send_email') {
      const gabaritObjet = champLocalise(config, 'subject', langue);
      const gabaritCorps = champLocalise(config, 'body', langue);
      const objet = sansPrenomVide(resolveTemplate(gabaritObjet, vars));
      const html = sansPrenomVide(resolveTemplate(gabaritCorps, vars, { html: true }));
      const rendu = { canal: 'email' as const, destinataire: courriel || null, objet, texte: htmlVersTexte(html), html };
      const vides = [...new Set([...variablesVides(gabaritObjet, vars), ...variablesVides(gabaritCorps, vars)])];
      const commun = { ...base, libelle, rendu, ...(vides.length ? { variables_vides: vides } : {}) };
      if (!courriel) return { ...commun, issue: 'ignoree', raison: dire('Aucune adresse courriel pour ce client', 'No email address for this client') };
      if (desabonne) return { ...commun, issue: 'ignoree', raison: fr ? motifSaut('courriel') : 'Client unsubscribed (email)' };
      if (avis && sansAvis) return { ...commun, issue: 'ignoree', raison: fr ? MOTIF_CLIENT_SANS_AVIS : 'Client marked “no review requests”' };
      return { ...commun, issue: 'partirait' };
    }
    if (type === 'request_review') {
      if (sansAvis) return ignoree(fr ? MOTIF_CLIENT_SANS_AVIS : 'Client marked “no review requests”');
      return { ...base, libelle, issue: 'partirait', raison: dire('Le texte vient de Réglages → Avis clients.', 'The text comes from Settings → Reviews.') };
    }
    if (modele?.vers_client && entite === 'automation_webhook_receipt') {
      return ignoree(dire('Aucun client : ce message n’aurait personne à qui partir.', 'No client: this message would have no one to go to.'));
    }
    // Une action interne : ses textes rendus, pour qu'on voie le titre de la tâche ou la note telle qu'elle serait écrite.
    const textes: Record<string, string> = {};
    for (const champ of modele?.champs ?? []) {
      if (champ.type !== 'zone' && champ.type !== 'texte') continue;
      const gabarit = champLocalise(config, champ.cle, langue);
      if (gabarit) textes[champ.cle] = resolveTemplate(gabarit, vars);
    }
    return {
      ...base, libelle, issue: 'partirait',
      ...(Object.keys(textes).length ? { textes } : {}),
      raison: dire('Non exécutée pendant l’essai.', 'Not executed during the test.'),
    };
  });

  if (etapes.length === 0) {
    avertissements.push(dire('Cette automatisation n’a encore aucune étape.', 'This automation has no step yet.'));
  }
  if (!trouverDeclencheur(declencheur)) {
    avertissements.push(dire('Le déclencheur de cette automatisation n’est plus offert : elle ne partirait pas.', 'This automation’s trigger is no longer offered: it would not run.'));
  }
  if (nonJugees.size > 0) {
    avertissements.push(dire(
      'Une condition du parcours dépend de l’état de la fiche (statut, montant…) : l’essai ne la juge pas et montre les deux branches.',
      'A condition in the journey depends on the record’s state (status, amount…): the test does not judge it and shows both branches.',
    ));
  }
  avertissements.push(dire(
    'Rien n’a été envoyé ni modifié. L’essai ne rejoue pas le consentement commercial, la limite de messages par 24 h, les heures d’envoi ni les doublons : ils s’appliquent à l’envoi réel.',
    'Nothing was sent or changed. The test does not replay marketing consent, the 24-hour message limit, sending hours or duplicates: they apply to the real send.',
  ));

  return {
    simulation: true,
    client: { id: clientId, nom },
    fiche,
    ciblage: { cible: verdict.cible, raison: verdict.cible ? null : (verdict.phrase ?? verdict.raison) },
    etapes: sortie,
    avertissements,
  };
}
