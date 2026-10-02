/* ═══════════════════════════════════════════════════════════════
   « QUI EST CIBLÉ » — côté serveur : lire la fiche, juger, compter.

   Le jugement lui-même est dans `src/lib/automationCiblage.ts` (pur, partagé
   avec l'éditeur). Ici : ce qu'il faut LIRE en base pour le rendre.

     · `ciblageOk`     — le moteur : ce client-ci est-il ciblé, maintenant ?
                         Appelé au déclenchement, avant chaque envoi différé,
                         et quand une autre automatisation démarre celle-ci.
     · `apercuCiblage` — l'éditeur : « Touche X clients », dont combien ne
                         recevront rien (STOP, désabonnés, sans téléphone, sans
                         courriel, « aucune demande d'avis »), et les 20 premiers.

   UN SEUL chargement (`chargerFiches`) et UN SEUL évaluateur (`evaluerCiblage`)
   servent aux deux : le compteur ne peut pas annoncer autre chose que ce que le
   moteur fera.

   RÈGLES DE PRUDENCE
     · aucun ciblage posé → vrai, sans une seule lecture ;
     · un ciblage posé sur une fiche sans client (visite sans job, appel reçu
       de l'extérieur) → hors ciblage : on n'écrit pas au hasard ;
     · une lecture ratée → hors ciblage, avec une trace (`logger`) et
       `erreur: true` — l'appelant peut préférer reprendre plus tard ;
     · seuls les champs CITÉS par le ciblage sont lus ; les étiquettes ne sont
       lues que si une règle en parle.
   ═══════════════════════════════════════════════════════════════ */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  lireCiblage, evaluerCiblage, champsCites, citeDesEtiquettes, ciblageVide, phraseHorsCiblage,
  CLE_CHAMP_SANS_AVIS, CODE_HORS_CIBLAGE,
  type Ciblage, type CiblageLu, type FicheClient, type VerdictCiblage, type CanalClient,
} from '../../src/lib/automationCiblage';
import type { TypeChamp, ValeurChamp } from '../../src/lib/champs/types';
import { lireValeur, type ColonnesValeur } from '../../src/lib/champs/valeurs';
import { clientDeLEntite } from './actions';
import { fuseauOrg } from './automations-fuseau-org';
import { normalizeE164 } from './helpers';
import { logger } from './logger';

export { estDemandeDAvis, regleDemandeUnAvis } from '../../src/lib/automationCiblage';

/** Au-delà, le compteur dit « plus de 20 000 clients » (voir la conception : une fonction SQL prendrait le relais). */
export const PLAFOND_APERCU_CIBLAGE = 20_000;
/** Nombre de clients montrés par « Voir la liste ». */
export const TAILLE_APERCU_CIBLAGE = 20;
/** Nombre de clients touchés gardés au-delà des 20 affichés. */
export const CANDIDATS_APERCU_CIBLAGE = 200;
const PAGE = 1000;

/** Une fiche chargée : ce que le ciblage juge, plus de quoi dire si le client est joignable. */
export interface FicheChargee extends FicheClient {
  first_name: string | null;
  last_name: string | null;
  display_as_company: boolean;
  phone: string | null;
  email: string | null;
  email_opt_out_at: string | null;
}

export interface FichesChargees {
  fiches: FicheChargee[];
  /** Le carnet dépasse le plafond : seules les `plafond` premières fiches sont là. */
  tronque: boolean;
  /** Libellé de chaque champ cité, par id — pour la raison écrite au journal. */
  libelles: Record<string, string>;
}

class LectureRatee extends Error {
  constructor(quoi: string, message: string) {
    super(`${quoi} : ${message}`);
    this.name = 'LectureRatee';
  }
}

type Reponse<T> = { data: T[] | null; error: { message: string } | null };

/** Lit une requête paginée jusqu'au bout, ou jusqu'à `max` lignes (+1 pour savoir s'il en reste). */
async function toutesLesPages<T>(
  quoi: string, lire: (de: number, a: number) => PromiseLike<Reponse<T>>, max = Number.POSITIVE_INFINITY,
): Promise<{ lignes: T[]; reste: boolean }> {
  const lignes: T[] = [];
  for (let de = 0; ; de += PAGE) {
    const { data, error } = await lire(de, de + PAGE - 1);
    if (error) throw new LectureRatee(quoi, error.message);
    lignes.push(...(data ?? []));
    if (lignes.length > max) return { lignes: lignes.slice(0, max), reste: true };
    if ((data ?? []).length < PAGE) return { lignes, reste: false };
  }
}

const COLONNES_FICHE = 'id, first_name, last_name, company, display_as_company, status, city, lead_source, source, phone, email, email_opt_out_at';
const COLONNES_VALEUR = 'id, field_id, client_id, value_text, value_number, value_money_cents, value_date, value_timestamp, value_option_id, value_boolean';

type LigneFiche = Omit<FicheChargee, 'etiquettes' | 'champs' | 'typesChamps'>;
type LigneValeur = Partial<ColonnesValeur> & { id: string; field_id: string; client_id: string };
type LigneChamp = { id: string; label: string; field_type: TypeChamp; config: { include_time?: boolean } | null };

/**
 * Charge les fiches à juger : UN client (`clientId`) ou tout le carnet du
 * bureau (jusqu'à `plafond`). Lève `LectureRatee` à la première lecture qui
 * échoue — jamais un résultat partiel pris pour un résultat.
 *
 * `champsEnPlus` : des champs à lire même si le ciblage ne les cite pas (le
 * champ « Aucune demande d'avis » pour le compteur d'une demande d'avis).
 */
export async function chargerFiches(
  db: SupabaseClient, orgId: string, ciblage: Ciblage | CiblageLu | null,
  options: { clientId?: string; plafond?: number; champsEnPlus?: string[] } = {},
): Promise<FichesChargees> {
  const plafond = options.plafond ?? PLAFOND_APERCU_CIBLAGE;

  // 1. Les fiches.
  let lignes: LigneFiche[];
  let tronque = false;
  if (options.clientId) {
    const { data, error } = await db.from('clients').select(COLONNES_FICHE)
      .eq('org_id', orgId).eq('id', options.clientId).is('deleted_at', null).limit(1);
    if (error) throw new LectureRatee('fiche du client', error.message);
    lignes = (data ?? []) as unknown as LigneFiche[];
  } else {
    const r = await toutesLesPages<LigneFiche>('carnet de clients', (de, a) => db.from('clients').select(COLONNES_FICHE)
      .eq('org_id', orgId).is('deleted_at', null).order('id').range(de, a) as unknown as PromiseLike<Reponse<LigneFiche>>, plafond);
    lignes = r.lignes;
    tronque = r.reste;
  }

  // 2. Les étiquettes — seulement si une règle en parle.
  const etiquettes = new Map<string, string[]>();
  if (citeDesEtiquettes(ciblage) && lignes.length > 0) {
    const r = await toutesLesPages<{ client_id: string; tag: string }>('étiquettes', (de, a) => {
      const q = options.clientId
        ? db.from('client_tags').select('client_id, tag').eq('client_id', options.clientId)
        : db.from('client_tags').select('client_id, tag, clients!inner(org_id)').eq('clients.org_id', orgId);
      return q.order('id').range(de, a) as unknown as PromiseLike<Reponse<{ client_id: string; tag: string }>>;
    });
    for (const l of r.lignes) etiquettes.set(l.client_id, [...(etiquettes.get(l.client_id) ?? []), l.tag]);
  }

  // 3. Les champs personnalisés cités — ceux de la fiche CLIENT seulement.
  const idsChamps = [...new Set([...champsCites(ciblage), ...(options.champsEnPlus ?? [])])];
  const types: Record<string, TypeChamp> = {};
  const avecHeure: Record<string, boolean> = {};
  const libelles: Record<string, string> = {};
  const valeurs = new Map<string, FicheClient['champs']>();
  if (idsChamps.length > 0 && lignes.length > 0) {
    const { data: champs, error } = await db.from('custom_fields').select('id, label, field_type, config')
      .eq('org_id', orgId).eq('object_type', 'client').in('id', idsChamps);
    if (error) throw new LectureRatee('champs personnalisés', error.message);
    for (const c of (champs ?? []) as unknown as LigneChamp[]) {
      types[c.id] = c.field_type;
      avecHeure[c.id] = c.config?.include_time === true;
      libelles[c.id] = c.label;
    }
    const connus = Object.keys(types);
    if (connus.length > 0) {
      const r = await toutesLesPages<LigneValeur>('valeurs des champs', (de, a) => {
        let q = db.from('custom_field_values').select(COLONNES_VALEUR)
          .eq('org_id', orgId).eq('object_type', 'client').in('field_id', connus);
        if (options.clientId) q = q.eq('client_id', options.clientId);
        return q.order('id').range(de, a) as unknown as PromiseLike<Reponse<LigneValeur>>;
      });
      // Les choix multiples vivent dans une table à part.
      const multiples = r.lignes.filter((l) => types[l.field_id] === 'dropdown_multi').map((l) => l.id);
      const options_ = new Map<string, string[]>();
      for (let i = 0; i < multiples.length; i += 200) {
        const { data: vo, error: evo } = await db.from('custom_field_value_options').select('value_id, option_id')
          .eq('org_id', orgId).in('value_id', multiples.slice(i, i + 200));
        if (evo) throw new LectureRatee('options choisies', evo.message);
        for (const o of (vo ?? []) as Array<{ value_id: string; option_id: string }>) {
          options_.set(o.value_id, [...(options_.get(o.value_id) ?? []), o.option_id]);
        }
      }
      for (const l of r.lignes) {
        const type = types[l.field_id];
        const valeur: ValeurChamp = lireValeur(type, l, options_.get(l.id) ?? []);
        valeurs.set(l.client_id, { ...(valeurs.get(l.client_id) ?? {}), [l.field_id]: { type, valeur, avecHeure: avecHeure[l.field_id] } });
      }
    }
  }

  return {
    fiches: lignes.map((l) => ({
      ...l,
      display_as_company: l.display_as_company === true,
      etiquettes: etiquettes.get(l.id) ?? [],
      champs: valeurs.get(l.id) ?? {},
      typesChamps: types,
    })),
    tronque,
    libelles,
  };
}

export interface VerdictCiblageMoteur extends VerdictCiblage {
  /** La phrase à écrire au journal (`result_data.saute`) quand le client n'est pas ciblé. */
  phrase: string | null;
  /** Le code à écrire au journal (`result_data.saute_code`). */
  code: typeof CODE_HORS_CIBLAGE | null;
  /** Vrai quand « hors ciblage » vient d'une LECTURE RATÉE, pas d'un jugement. */
  erreur?: boolean;
}

const CIBLE: VerdictCiblageMoteur = { cible: true, raison: null, phrase: null, code: null };
const horsCiblage = (raison: string, erreur = false, fr = true): VerdictCiblageMoteur => ({
  cible: false, raison, phrase: phraseHorsCiblage(raison, fr), code: CODE_HORS_CIBLAGE, ...(erreur ? { erreur: true } : {}),
});

/**
 * Le client de cette fiche est-il ciblé par la règle, MAINTENANT ?
 *
 * `conditions` : les `conditions` de la règle (nouvelle clé `ciblage` et
 * anciennes clés d'étiquette — voir `lireCiblage`). Les autres conditions
 * (occurrence visée, filtres de l'événement) ne sont pas de son ressort.
 *
 * Rend le verdict et, quand le client est écarté, la phrase du journal :
 * « Ignoré : hors ciblage — exclu par l’étiquette « Ne pas relancer » ».
 */
export async function ciblageOk(
  supabase: SupabaseClient, orgId: string, entityType: string, entityId: string,
  conditions: Record<string, unknown> | null | undefined,
  /** `fr: false` : la raison en anglais (écran « Tester avec un client »). Le moteur ne le passe pas : le journal est en français. */
  options: { fr?: boolean } = {},
): Promise<VerdictCiblageMoteur> {
  const ciblage = lireCiblage(conditions);
  if (ciblageVide(ciblage)) return CIBLE;
  const fr = options.fr !== false;
  const non = (f: string, e: string, erreur = false) => horsCiblage(fr ? f : e, erreur, fr);
  try {
    const clientId = await clientDeLEntite({ supabase, orgId, entityType, entityId });
    if (!clientId) return non('aucun client n’est lié à cette fiche', 'no client is linked to this record');
    const { fiches, libelles } = await chargerFiches(supabase, orgId, ciblage, { clientId });
    if (!fiches[0]) return non('la fiche du client est introuvable', 'the client record cannot be found');
    // Le fuseau ne sert qu'aux comparaisons de dates : lu seulement si un champ est cité.
    const fuseau = champsCites(ciblage).length > 0 ? await fuseauOrg(supabase, orgId) : undefined;
    const v = evaluerCiblage(ciblage, fiches[0], { fuseau, fr }, libelles);
    return v.cible ? CIBLE : non(v.raison ?? 'ne correspond pas au ciblage', v.raison ?? 'does not match the targeting');
  } catch (err) {
    logger.error('[automations-ciblage] ciblage illisible — client tenu hors ciblage', {
      orgId, entity_type: entityType, entity_id: entityId, message: err instanceof Error ? err.message : String(err),
    });
    return non('le ciblage n’a pas pu être vérifié (lecture impossible)', 'the targeting could not be checked (read failed)', true);
  }
}

// ── Compteur « Touche X clients » ───────────────────────────

export interface ClientApercu {
  id: string;
  nom: string;
  /** Ce client ne recevra pas de texto / de courriel / de demande d'avis, et pourquoi. */
  empechements: Array<'stop_texto' | 'desabonne_courriel' | 'sans_telephone' | 'sans_courriel' | 'sans_avis'>;
}

export interface ApercuCiblage {
  /** Clients du carnet qui correspondent au ciblage (pas « messages qui partiront » : ça dépend des événements à venir). */
  total: number;
  /** Parmi eux, ceux qui ne recevront rien sur un canal demandé. */
  dont: { stop_texto: number; desabonnes_courriel: number; sans_telephone: number; sans_courriel: number; sans_avis: number };
  /** Les premiers clients touchés, par ordre alphabétique. */
  apercu: ClientApercu[];
  /** Les 200 premiers clients touchés (même ordre que `apercu`) — pour un écran qui pagine, et pour comparer le compteur au moteur. */
  candidats: ClientApercu[];
  /** Le carnet dépasse le plafond : `total` ne compte que les `plafond` premières fiches. */
  tronque: boolean;
  plafond: number;
  /** Nombre de fiches lues (le carnet, ou le plafond). */
  carnet: number;
}

/** Le nom d'un client, comme la fiche l'affiche. */
export function nomDuClient(f: Pick<FicheChargee, 'first_name' | 'last_name' | 'company' | 'display_as_company'>, fr = true): string {
  const personne = `${f.first_name ?? ''} ${f.last_name ?? ''}`.replace(/\s+/g, ' ').trim();
  const compagnie = (f.company ?? '').trim();
  if (f.display_as_company && compagnie) return compagnie;
  return personne || compagnie || (fr ? '(sans nom)' : '(no name)');
}

/**
 * « Touche X clients » : le carnet du bureau passé par le MÊME évaluateur que
 * l'exécution. `canaux` et `demandeAvis` décident des sous-comptes : STOP et
 * sans téléphone n'ont de sens que si l'automatisation envoie un texto.
 *
 * Lève si une lecture échoue : l'écran dit alors « compteur indisponible »,
 * jamais un faux nombre.
 */
export async function apercuCiblage(
  db: SupabaseClient, orgId: string,
  options: { ciblage: Ciblage | CiblageLu | null; canaux?: CanalClient[]; demandeAvis?: boolean; fr?: boolean; plafond?: number },
): Promise<ApercuCiblage> {
  const canaux = new Set(options.canaux ?? []);
  const plafond = options.plafond ?? PLAFOND_APERCU_CIBLAGE;
  const fr = options.fr !== false;

  // Le champ « Aucune demande d'avis » du bureau (absent ou archivé : personne n'est exclu).
  let champSansAvis: string | null = null;
  if (options.demandeAvis) {
    const { data, error } = await db.from('custom_fields').select('id')
      .eq('org_id', orgId).eq('object_type', 'client').eq('key', CLE_CHAMP_SANS_AVIS).is('archived_at', null).limit(1);
    if (error) throw new LectureRatee('champ « aucune demande d’avis »', error.message);
    champSansAvis = ((data ?? [])[0] as { id?: string } | undefined)?.id ?? null;
  }

  const { fiches, tronque, libelles } = await chargerFiches(db, orgId, options.ciblage, {
    plafond, champsEnPlus: champSansAvis ? [champSansAvis] : [],
  });
  const fuseau = champsCites(options.ciblage).length > 0 ? await fuseauOrg(db, orgId) : undefined;
  const touches = fiches.filter((f) => evaluerCiblage(options.ciblage, f, { fuseau }, libelles).cible);

  // STOP et désabonnements — lus seulement pour les canaux demandés.
  const stop = new Set<string>();
  if (canaux.has('sms') && touches.length > 0) {
    const r = await toutesLesPages<{ phone: string }>('STOP', (de, a) => db.from('sms_opt_outs').select('phone')
      .eq('org_id', orgId).order('id').range(de, a) as unknown as PromiseLike<Reponse<{ phone: string }>>);
    for (const l of r.lignes) stop.add(l.phone);
  }
  const desabonnes = new Set<string>();
  if (canaux.has('email') && touches.length > 0) {
    // `pending` = simple porteur de jeton (le lien du pied de page), pas un désabonnement.
    const r = await toutesLesPages<{ email: string }>('désabonnements', (de, a) => db.from('email_unsubscribes').select('email')
      .eq('org_id', orgId).neq('category', 'pending').order('id').range(de, a) as unknown as PromiseLike<Reponse<{ email: string }>>);
    for (const l of r.lignes) desabonnes.add(String(l.email).trim().toLowerCase());
  }

  const dont = { stop_texto: 0, desabonnes_courriel: 0, sans_telephone: 0, sans_courriel: 0, sans_avis: 0 };
  const empechementsDe = (f: FicheChargee): ClientApercu['empechements'] => {
    const e: ClientApercu['empechements'] = [];
    const telephone = (f.phone ?? '').trim();
    const courriel = (f.email ?? '').trim().toLowerCase();
    if (canaux.has('sms')) {
      if (!telephone) e.push('sans_telephone');
      else if (stop.has(normalizeE164(telephone))) e.push('stop_texto');
    }
    if (canaux.has('email')) {
      if (!courriel) e.push('sans_courriel');
      else if (desabonnes.has(courriel) || f.email_opt_out_at) e.push('desabonne_courriel');
    }
    if (champSansAvis && f.champs[champSansAvis]?.valeur === true) e.push('sans_avis');
    return e;
  };
  const avecEmpechements = touches.map((f) => ({ f, empechements: empechementsDe(f) }));
  for (const { empechements } of avecEmpechements) {
    for (const e of empechements) {
      if (e === 'desabonne_courriel') dont.desabonnes_courriel++;
      else dont[e]++;
    }
  }

  const tries = avecEmpechements
    .map(({ f, empechements }) => ({ id: f.id, nom: nomDuClient(f, fr), empechements }))
    .sort((x, y) => x.nom.localeCompare(y.nom, fr ? 'fr' : 'en', { sensitivity: 'base' }) || x.id.localeCompare(y.id));

  return {
    total: touches.length,
    dont,
    apercu: tries.slice(0, TAILLE_APERCU_CIBLAGE),
    candidats: tries.slice(0, CANDIDATS_APERCU_CIBLAGE),
    tronque,
    plafond,
    carnet: fiches.length,
  };
}
