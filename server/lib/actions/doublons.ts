/* ═══════════════════════════════════════════════════════════════
   DOUBLONS — un client ne reçoit jamais deux fois le même message.

   Décision du propriétaire (mission, point 7) : AVERTIR à la publication
   (`server/lib/automations-conflits.ts`), et à l'envoi n'en laisser partir
   qu'UN. Ce module est la garde d'envoi, appelée par `executeSendEmail` et
   `executeSendSms` juste avant de remettre le message au fournisseur.

   « LE MÊME MESSAGE », pour un même destinataire et un même canal, dans la
   fenêtre (24 h par défaut, `AUTOMATION_FENETRE_DOUBLON_HEURES`) :
     1. le même texte une fois normalisé (casse, accents, ponctuation, espaces ;
        un lien vaut « lien ») — quelle que soit la fiche ;
     2. OU la même fiche (même facture, même devis, même rendez-vous…) ET une
        similarité ≥ 0,8 sur les mots utiles ;
     3. OU la même fiche, le même déclencheur ET le même lien public
        (/invoice/…, /quote/…, /pay/…) — la relance lourdement reformulée.

   JAMAIS entre deux envois de la MÊME automatisation : une suite « la veille »
   puis « 2 h avant » est voulue par celui qui l'a écrite. Les reprises d'une
   même règle ont leur propre garde (« déjà envoyé », actions/index.ts).

   LE SEUIL (0,8) est mesuré, pas choisi : sur les 87 messages fournis par
   Lume, deux messages de familles différentes ne dépassent jamais 0,63 ; un
   préréglage et sa reprise dans le pack de base sont à 0,79 – 1
   (scripts/qa/finale/e/analyse-similarite-prereglages.mts ; rejoué sur CE
   module par tests/automations-finale/p/doublons-pur.test.ts).

   SANS MIGRATION. Chaque envoi RÉSERVE sa place par une ligne technique de
   `automation_execution_logs` (`action_type = 'reservation'`) dont la clé
   `doublon:<canal>:<destinataire>:<empreinte>:<jour>` tombe sous l'index
   unique déjà en place (`idx_execution_logs_immediat_dedup`). Deux
   consommateurs qui envoient le même texte au même instant : une seule
   insertion passe, l'autre reçoit 23505 — c'est le doublon. La ligne porte
   aussi le texte normalisé : c'est elle que la lecture des 24 h relit pour
   juger un message « quasi identique ». Elle n'est ni un envoi ni une étape :
   les compteurs et l'onglet Journaux doivent l'ignorer, comme `'conditions'`.

   EN CAS DE DOUTE, ON ENVOIE. Une lecture ou une réservation ratée ne retient
   jamais un message (un message de trop vaut mieux qu'une relance perdue) ;
   elle laisse une trace.
   ═══════════════════════════════════════════════════════════════ */

import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../logger';

/** Fenêtre par défaut : 24 h, glissante, par destinataire et par canal. */
export const FENETRE_DOUBLON_HEURES_DEFAUT = 24;
export const SEUIL_QUASI_IDENTIQUE = 0.8;
/** Le « type d'action » de la ligne technique de réservation. */
export const ACTION_RESERVATION = 'reservation';
/** Le code de saut écrit au journal pour le message non envoyé. */
export const CODE_DOUBLON = 'doublon';
/** Longueur gardée du texte normalisé (assez pour juger, pas une archive du message). */
const TEXTE_GARDE_MAX = 600;
const FUSEAU_DEFAUT = 'America/Toronto';

/**
 * La fenêtre, en heures. `AUTOMATION_FENETRE_DOUBLON_HEURES=0` coupe la garde
 * (interrupteur d'urgence) ; une valeur illisible rend le défaut ; au plus 7 jours.
 */
export function fenetreDoublonHeures(): number {
  const brut = process.env.AUTOMATION_FENETRE_DOUBLON_HEURES;
  if (brut === undefined || brut.trim() === '') return FENETRE_DOUBLON_HEURES_DEFAUT;
  const n = Number(brut);
  if (!Number.isFinite(n) || n < 0) return FENETRE_DOUBLON_HEURES_DEFAUT;
  return Math.min(n, 168);
}

// ── Fonctions pures ─────────────────────────────────────────

const LIEN = /https?:\/\/[^\s<>"')]+/gi;
const LIEN_PUBLIC = /\/(invoice|quote|pay|survey|contract)\//;

/** Le texte lisible d'un message (un courriel arrive en HTML). */
export function texteBrut(message: string): string {
  return message
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, ' $2 $1 ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

/** Les liens d'un message, sans leurs paramètres de suivi. */
export function liensDe(message: string): string[] {
  return [...new Set((texteBrut(message).match(LIEN) ?? []).map((l) => l.replace(/[?#].*$/, '').replace(/[.,;:!]+$/, '').toLowerCase()))];
}

/** Les liens PUBLICS d'un message (facture, devis, paiement, sondage, contrat). */
export function liensPublicsDe(message: string): string[] {
  return liensDe(message).filter((l) => LIEN_PUBLIC.test(l));
}

/** Casse, accents, ponctuation, espaces : ce qui ne change pas le sens. Un lien devient « lien ». */
export function normaliserMessage(message: string): string {
  return texteBrut(message)
    .replace(LIEN, ' lien ')
    .toLowerCase()
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/[’']/g, ' ')
    .replace(/[^\p{L}\p{N}$%]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const sha = (texte: string, longueur: number) => createHash('sha1').update(texte).digest('hex').slice(0, longueur);

/** L'empreinte d'un message : deux textes qui ne diffèrent que par la forme ont la même. */
export function empreinte(message: string): string {
  return sha(normaliserMessage(message), 20);
}

/**
 * L'empreinte d'un destinataire sur un canal : le journal ne garde ni le
 * numéro ni l'adresse. Texto : les chiffres, avec l'indicatif (un numéro à
 * 10 chiffres est nord-américain) ; courriel : l'adresse en minuscules.
 */
export function empreinteDestinataire(canal: 'sms' | 'email', destinataire: string): string {
  if (canal === 'email') return sha(`email:${destinataire.trim().toLowerCase()}`, 16);
  const chiffres = destinataire.replace(/\D/g, '');
  return sha(`sms:${chiffres.length === 10 ? `1${chiffres}` : chiffres}`, 16);
}

/** Les mots vides ne disent rien du sujet : « bonjour », « merci », « de », « la »… */
const MOTS_VIDES = new Set(('bonjour bonsoir salut merci cordialement bientot a au aux avec ce ces cet cette d dans de des du en est et il ils je l la le les leur lui ma mais me mon ne nos notre nous on ou par pas pour qu que qui s sa se ses si son sur ta te tes ton tu un une vos votre vous y '
  + 'hi hello thanks thank you the a an and are as at be by for from has have i if in is it of on or our so that this to us we with your').split(' '));

function motsUtiles(norme: string): string[] {
  return norme.split(' ').filter((m) => m !== '' && !MOTS_VIDES.has(m));
}

/**
 * Similarité de deux textes DÉJÀ normalisés, de 0 à 1 : coefficient de Dice
 * sur les MOTS utiles (chaque mot compte autant de fois qu'il apparaît ;
 * l'ordre ne compte pas). Une mesure sur les paires de mots consécutifs a été
 * essayée et écartée : sur un texto court, UN mot inséré la fait tomber à 0,57.
 */
export function similariteNormes(a: string, b: string): number {
  const x = motsUtiles(a);
  const y = motsUtiles(b);
  if (x.length === 0 || y.length === 0) return a === b ? 1 : 0;
  const reste = new Map<string, number>();
  for (const m of x) reste.set(m, (reste.get(m) ?? 0) + 1);
  let commun = 0;
  for (const m of y) {
    const n = reste.get(m) ?? 0;
    if (n > 0) { commun++; reste.set(m, n - 1); }
  }
  return (2 * commun) / (x.length + y.length);
}

/** Similarité de deux messages tels qu'écrits. */
export function similarite(a: string, b: string): number {
  return similariteNormes(normaliserMessage(a), normaliserMessage(b));
}

/** Un envoi déjà parti (ou réservé), tel que la garde le relit. */
export interface EnvoiPasse {
  regleId: string;
  /** Le déclencheur de l'automatisation qui a envoyé (`invoice.sent`, `job.completed`…). */
  declencheur: string;
  /** `type:id` de la fiche de l'événement (facture, devis, rendez-vous, client…). */
  fiche: string;
  /** L'empreinte du texte entier. */
  empreinte: string;
  /** Le texte normalisé (rogné). */
  norme: string;
  /** Les liens publics du message. */
  liens: string[];
  quand: Date;
  nomRegle?: string | null;
}

/** Un envoi passé, bâti depuis le texte tel qu'écrit (tests, rejeux). */
export function envoiPasse(p: { regleId: string; declencheur: string; fiche: string; texte: string; quand: Date; nomRegle?: string | null }): EnvoiPasse {
  return {
    regleId: p.regleId, declencheur: p.declencheur, fiche: p.fiche, quand: p.quand, nomRegle: p.nomRegle ?? null,
    empreinte: empreinte(p.texte), norme: normaliserMessage(p.texte).slice(0, TEXTE_GARDE_MAX), liens: liensPublicsDe(p.texte),
  };
}

export type MotifDoublon = 'identique' | 'quasi_identique' | 'meme_lien';
export interface VerdictDoublon { doublon: boolean; motif?: MotifDoublon; de?: EnvoiPasse; similarite?: number }

/**
 * Ce message est-il un doublon d'un envoi déjà parti au MÊME destinataire, sur
 * le MÊME canal ? `passes` : les envois d'automatisations de la fenêtre.
 *
 * Le déclencheur compte pour la règle du lien : une relance de facture le
 * matin et le reçu de paiement l'après-midi portent le même lien `/invoice/…`
 * et ne sont PAS le même message.
 */
export function estDoublon(
  nouveau: { regleId: string; declencheur: string; fiche: string; texte: string },
  passes: EnvoiPasse[],
  maintenant: Date = new Date(),
  fenetreHeures: number = fenetreDoublonHeures(),
): VerdictDoublon {
  const depuis = maintenant.getTime() - fenetreHeures * 3600_000;
  const signature = empreinte(nouveau.texte);
  const norme = normaliserMessage(nouveau.texte).slice(0, TEXTE_GARDE_MAX);
  const liens = liensPublicsDe(nouveau.texte);
  for (const p of passes) {
    if (p.quand.getTime() < depuis) continue;
    if (p.regleId === nouveau.regleId) continue; // la même automatisation : c'est sa suite, pas un doublon
    if (p.empreinte === signature) return { doublon: true, motif: 'identique', de: p, similarite: 1 };
    if (p.fiche !== nouveau.fiche) continue;
    const s = similariteNormes(p.norme, norme);
    if (s >= SEUIL_QUASI_IDENTIQUE) return { doublon: true, motif: 'quasi_identique', de: p, similarite: s };
    if (p.declencheur === nouveau.declencheur && liens.some((l) => p.liens.includes(l))) {
      return { doublon: true, motif: 'meme_lien', de: p, similarite: s };
    }
  }
  return { doublon: false };
}

/** « à 14 h 02 », « hier à 14 h 02 », « le 12 octobre à 14 h 02 » — dans le fuseau de l'entreprise. */
export function quandLisible(quand: Date, maintenant: Date, fuseau: string = FUSEAU_DEFAUT): string {
  const dans = (d: Date, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('fr-CA', { timeZone: fuseau, ...options });
  const parties = dans(quand, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(quand);
  const heure = `${Number(parties.find((p) => p.type === 'hour')?.value ?? 0)} h ${parties.find((p) => p.type === 'minute')?.value ?? '00'}`;
  const jour = (d: Date) => dans(d, { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  if (jour(quand) === jour(maintenant)) return `à ${heure}`;
  if (jour(quand) === jour(new Date(maintenant.getTime() - 86_400_000))) return `hier à ${heure}`;
  return `le ${dans(quand, { day: 'numeric', month: 'long' }).format(quand)} à ${heure}`;
}

/** La phrase du journal : « Ignoré : doublon de « Relance de facture », envoyé à 14 h 02 ». */
export function phraseDoublon(de: Pick<EnvoiPasse, 'nomRegle' | 'quand'> | undefined, maintenant: Date = new Date(), fuseau: string = FUSEAU_DEFAUT): string {
  if (!de) return 'Ignoré : doublon d’un message déjà envoyé par une autre automatisation';
  const quand = quandLisible(de.quand, maintenant, fuseau);
  return de.nomRegle
    ? `Ignoré : doublon de « ${de.nomRegle} », envoyé ${quand}`
    : `Ignoré : doublon d’un message envoyé ${quand} par une autre automatisation`;
}

// ── La garde d'envoi ────────────────────────────────────────

/**
 * Ce que la garde lit du contexte d'une action. Mêmes noms que `ActionContext`
 * (actions/index.ts) — on peut lui passer le contexte tel quel une fois
 * `declencheur` et `nomRegle` posés par le moteur.
 */
export interface ContexteDoublon {
  supabase: SupabaseClient;
  orgId: string;
  entityType: string;
  entityId: string;
  /** La règle en cours. Absente (appel hors moteur) : la garde ne s'applique pas. */
  ruleId?: string | null;
  /** Le déclencheur de la règle (`invoice.overdue`…). */
  declencheur?: string | null;
  /** Le nom de la règle, pour que le journal de l'AUTRE automatisation puisse la nommer. */
  nomRegle?: string | null;
  /** Fuseau de l'entreprise, pour l'heure écrite au journal. */
  fuseau?: string | null;
}

export interface GardeDoublon {
  doublon: boolean;
  /** Quand `doublon` : la phrase à écrire au journal, avec le code `doublon`. */
  phrase?: string;
  motif?: MotifDoublon;
  /**
   * À appeler quand l'envoi n'a finalement PAS abouti (fournisseur en panne) :
   * rend la place, pour qu'une autre automatisation — ou la reprise — puisse
   * envoyer ce message. Ne lève jamais. Sans effet quand rien n'a été réservé.
   */
  liberer: () => Promise<void>;
}

const RIEN = async (): Promise<void> => {};
const PASSE: GardeDoublon = { doublon: false, liberer: RIEN };

interface LigneReservation {
  id?: string;
  automation_rule_id: string | null;
  created_at: string;
  result_data: { envoi?: { e?: string; t?: string; l?: string[]; fiche?: string; declencheur?: string; regle?: string; nom?: string | null } } | null;
}

function versEnvoiPasse(l: LigneReservation): EnvoiPasse | null {
  const e = l.result_data?.envoi;
  const regleId = e?.regle ?? l.automation_rule_id;
  if (!e || !regleId || typeof e.e !== 'string') return null;
  return {
    regleId, declencheur: e.declencheur ?? '', fiche: e.fiche ?? '', empreinte: e.e, norme: e.t ?? '', liens: Array.isArray(e.l) ? e.l : [],
    quand: new Date(l.created_at), nomRegle: e.nom ?? null,
  };
}

/** La clé unique d'une réservation : canal, destinataire, texte, jour (UTC). */
export function cleReservation(canal: 'sms' | 'email', destinataire: string, texte: string, maintenant: Date): string {
  return `doublon:${canal}:${empreinteDestinataire(canal, destinataire)}:${empreinte(texte)}:${maintenant.toISOString().slice(0, 10)}`;
}

/**
 * La garde, à appeler JUSTE AVANT de remettre le message au fournisseur — une
 * fois toutes les autres gardes passées (désabonnement, consentement, plafond).
 *
 * `texte` : le message tel que le client le lirait, SANS la mention « Répondez
 * STOP » ajoutée aux textos commerciaux (deux automatisations au même texte,
 * l'une commerciale et l'autre non, envoient le même message). Pour un
 * courriel : l'objet, un saut de ligne, puis le corps.
 *
 * Rend `doublon: true` + la phrase du journal, ou réserve la place et rend
 * `liberer()`. Ne lève jamais.
 */
export async function gardeDoublon(
  ctx: ContexteDoublon, canal: 'sms' | 'email', destinataire: string, texte: string, maintenant: Date = new Date(),
): Promise<GardeDoublon> {
  const fenetre = fenetreDoublonHeures();
  const regleId = ctx.ruleId;
  if (!regleId || fenetre <= 0 || !destinataire || !texte.trim()) return PASSE;

  const fiche = `${ctx.entityType}:${ctx.entityId}`;
  const declencheur = ctx.declencheur ?? '';
  const fuseau = ctx.fuseau || FUSEAU_DEFAUT;
  const a = empreinteDestinataire(canal, destinataire);
  const cle = cleReservation(canal, destinataire, texte, maintenant);
  const trace = (quoi: string, message: string) => logger.error(`[doublons] ${quoi} — le message part quand même`, {
    orgId: ctx.orgId, ruleId: regleId, canal, entity_type: ctx.entityType, entity_id: ctx.entityId, message,
  });

  try {
    // 1. Ce qui est déjà parti (ou réservé) vers ce destinataire, sur ce canal, dans la fenêtre.
    const { data, error } = await ctx.supabase
      .from('automation_execution_logs')
      .select('automation_rule_id, created_at, result_data')
      .eq('org_id', ctx.orgId)
      .eq('action_type', ACTION_RESERVATION)
      .like('execution_key', `doublon:${canal}:${a}:%`)
      .gte('created_at', new Date(maintenant.getTime() - fenetre * 3600_000).toISOString())
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) {
      trace('envois récents illisibles', error.message);
    } else {
      const passes = ((data ?? []) as unknown as LigneReservation[]).map(versEnvoiPasse).filter((p): p is EnvoiPasse => !!p);
      const v = estDoublon({ regleId, declencheur, fiche, texte }, passes, maintenant, fenetre);
      if (v.doublon) return { doublon: true, motif: v.motif, phrase: phraseDoublon(v.de, maintenant, fuseau), liberer: RIEN };
    }

    // 2. Réserver la place : l'index unique tranche entre deux consommateurs simultanés.
    const { data: reservee, error: refus } = await ctx.supabase
      .from('automation_execution_logs')
      .insert({
        org_id: ctx.orgId,
        automation_rule_id: regleId,
        trigger_event: declencheur || 'inconnu',
        entity_type: ctx.entityType,
        entity_id: ctx.entityId,
        action_type: ACTION_RESERVATION,
        action_config: {},
        result_success: true,
        result_data: {
          envoi: {
            c: canal, a, e: empreinte(texte), t: normaliserMessage(texte).slice(0, TEXTE_GARDE_MAX), l: liensPublicsDe(texte),
            fiche, declencheur, regle: regleId, nom: ctx.nomRegle ?? null,
          },
        },
        result_error: null,
        duration_ms: 0,
        execution_key: cle,
      })
      .select('id')
      .maybeSingle();

    if (refus) {
      if (refus.code !== '23505') {
        trace('réservation impossible', refus.message);
        return PASSE;
      }
      // La place est prise : par qui ? La même automatisation a le droit de se suivre.
      const { data: tenante, error: errTenante } = await ctx.supabase
        .from('automation_execution_logs')
        .select('automation_rule_id, created_at, result_data')
        .eq('org_id', ctx.orgId)
        .eq('execution_key', cle)
        .is('scheduled_task_id', null)
        .limit(1)
        .maybeSingle();
      if (errTenante) {
        trace('réservation existante illisible', errTenante.message);
        return PASSE;
      }
      const de = tenante ? versEnvoiPasse(tenante as unknown as LigneReservation) : null;
      // Libérée entre-temps, ou illisible : en cas de doute, on envoie.
      if (!de || de.regleId === regleId) return PASSE;
      return { doublon: true, motif: 'identique', phrase: phraseDoublon(de, maintenant, fuseau), liberer: RIEN };
    }

    const id = (reservee as { id?: string } | null)?.id;
    if (!id) return PASSE;
    return {
      doublon: false,
      liberer: async () => {
        // La clé repasse à NULL : l'index unique ne la voit plus, la lecture des 24 h non plus.
        const dire = (message: string) => logger.error(
          '[doublons] réservation non libérée — une autre automatisation au même texte sera ignorée pendant la fenêtre',
          { orgId: ctx.orgId, ruleId: regleId, canal, message },
        );
        try {
          const { error: errLiberer } = await ctx.supabase
            .from('automation_execution_logs')
            .update({ execution_key: null, result_data: { reservation_liberee: true } })
            .eq('id', id);
          if (errLiberer) dire(errLiberer.message);
        } catch (err) {
          dire(err instanceof Error ? err.message : String(err));
        }
      },
    };
  } catch (err) {
    trace('garde en erreur', err instanceof Error ? err.message : String(err));
    return PASSE;
  }
}
