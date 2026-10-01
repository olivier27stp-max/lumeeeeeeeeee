/**
 * Agent E — PROTOTYPE (enquête, pas du code produit) de la garde « un client ne reçoit
 * jamais deux fois le même message » proposée dans D:/lume-final/notes/E-conception.md,
 * « Conception 2 ». Fonctions PURES : rien n'est lu ni écrit.
 *
 * « Le même message », c'est :
 *   (a) le même texte une fois normalisé (casse, accents, ponctuation, espaces, liens) —
 *       pour n'importe quelle fiche ; ou
 *   (b) pour la MÊME fiche (même facture, même devis, même rendez-vous, même client) :
 *       deux textes quasi identiques (similarité ≥ SEUIL), ou — sur le même déclencheur —
 *       deux textes qui portent le même lien public (/invoice/…, /quote/…, /pay/…, /survey/…).
 * Jamais entre deux envois de la MÊME automatisation : une suite « veille » puis « 2 h
 * avant » est voulue par celui qui l'a écrite.
 */
import { createHash } from 'node:crypto';

export const FENETRE_DOUBLON_HEURES = 24;
export const SEUIL_QUASI_IDENTIQUE = 0.8;

const LIEN = /https?:\/\/[^\s<>"')]+/gi;

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

export function empreinte(message: string): string {
  return createHash('sha1').update(normaliserMessage(message)).digest('hex').slice(0, 20);
}

/** Les mots vides ne disent rien du sujet : « bonjour », « merci », « de », « la »… */
const MOTS_VIDES = new Set(('bonjour bonsoir salut merci cordialement bientot a au aux avec ce ces cet cette d dans de des du en est et il ils je l la le les leur lui ma mais me mon ne nos notre nous on ou par pas pour qu que qui s sa se ses si son sur ta te tes ton tu un une vos votre vous y '
  + 'hi hello thanks thank you the a an and are as at be by for from has have i if in is it of on or our so that this to us we with your').split(' '));

function motsUtiles(norm: string): string[] {
  return norm.split(' ').filter((m) => m !== '' && !MOTS_VIDES.has(m));
}

/**
 * Similarité de deux messages, de 0 à 1 : coefficient de Dice sur les MOTS utiles
 * (chaque mot compte autant de fois qu'il apparaît ; l'ordre ne compte pas).
 *
 * Mesuré sur les 87 messages fournis par Lume (analyse-similarite-prereglages.mts) :
 *   · deux messages de familles différentes (merci / avis / facture / devis / rendez-vous…)
 *     ne dépassent jamais 0,63 ;
 *   · un préréglage et sa version du pack de base (le même message, retouché) : 0,79 à 1 ;
 *   · une phrase à laquelle on ajoute ou change un mot : 0,9.
 * Une mesure sur les paires de mots consécutifs a été essayée et écartée : sur un texto
 * court, UN mot inséré la fait tomber à 0,57 (elle ratait la reformulation la plus banale).
 */
export function similarite(a: string, b: string): number {
  const x = motsUtiles(normaliserMessage(a));
  const y = motsUtiles(normaliserMessage(b));
  if (x.length === 0 || y.length === 0) return normaliserMessage(a) === normaliserMessage(b) ? 1 : 0;
  const reste = new Map<string, number>();
  for (const m of x) reste.set(m, (reste.get(m) ?? 0) + 1);
  let commun = 0;
  for (const m of y) {
    const n = reste.get(m) ?? 0;
    if (n > 0) { commun++; reste.set(m, n - 1); }
  }
  return (2 * commun) / (x.length + y.length);
}

export interface EnvoiPasse {
  regleId: string;
  /** Le déclencheur de l'automatisation qui a envoyé (`invoice.sent`, `job.completed`…). */
  declencheur: string;
  /** `type:id` de la fiche de l'événement (facture, devis, rendez-vous, client…). */
  fiche: string;
  texte: string;
  quand: Date;
  nomRegle?: string;
}

export interface Verdict { doublon: boolean; motif?: 'identique' | 'quasi_identique' | 'meme_lien'; de?: EnvoiPasse; similarite?: number }

const LIEN_PUBLIC = /\/(invoice|quote|pay|survey|contract)\//;

/**
 * Ce message est-il un doublon d'un envoi déjà parti au MÊME destinataire, sur le MÊME canal ?
 * `passes` : les envois d'automatisations des dernières `FENETRE_DOUBLON_HEURES` heures à ce destinataire.
 *
 *   1. même texte (normalisé), quelle que soit la fiche ;
 *   2. même fiche ET texte quasi identique ;
 *   3. même fiche, même déclencheur ET même lien public — la reformulation lourde d'une relance.
 *      Le déclencheur compte : une relance de facture le matin et le reçu de paiement l'après-midi
 *      portent le même lien `/invoice/…` et ne sont PAS le même message.
 */
export function estDoublon(
  nouveau: { regleId: string; declencheur: string; fiche: string; texte: string },
  passes: EnvoiPasse[],
  maintenant: Date = new Date(),
): Verdict {
  const depuis = maintenant.getTime() - FENETRE_DOUBLON_HEURES * 3600_000;
  const norme = normaliserMessage(nouveau.texte);
  const liens = liensDe(nouveau.texte).filter((l) => LIEN_PUBLIC.test(l));
  for (const p of passes) {
    if (p.quand.getTime() < depuis) continue;
    if (p.regleId === nouveau.regleId) continue; // la même automatisation : c'est sa suite, pas un doublon
    if (normaliserMessage(p.texte) === norme) return { doublon: true, motif: 'identique', de: p, similarite: 1 };
    if (p.fiche !== nouveau.fiche) continue;
    const s = similarite(p.texte, nouveau.texte);
    if (s >= SEUIL_QUASI_IDENTIQUE) return { doublon: true, motif: 'quasi_identique', de: p, similarite: s };
    if (p.declencheur === nouveau.declencheur && liens.some((l) => liensDe(p.texte).includes(l))) {
      return { doublon: true, motif: 'meme_lien', de: p, similarite: s };
    }
  }
  return { doublon: false };
}
