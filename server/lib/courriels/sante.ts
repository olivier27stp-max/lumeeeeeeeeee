/**
 * Santé des courriels : alerte quotidienne sur le taux de rebond (2026-09-17).
 * ──────────────────────────────────────────────────────────────────────────
 * Un domaine d'envoi qui rebondit trop se fait classer en pourriel par Gmail
 * et Outlook — pour TOUS les clients de Lume, pas seulement l'entreprise qui
 * a saisi de mauvaises adresses. Personne ne regardait ce taux.
 *
 * Chaque matin à 8 h (Montréal), sur les 24 dernières heures de
 * email_deliveries : envoyés, non livrés (bounced), plaintes (complained),
 * taux = (bounced + complained) / total. Si taux > 2 % ET au moins 20 envois
 * (sous 20, un seul rebond fait 5 % : du bruit), UN courriel à l'exploitant
 * (ALERT_EMAIL, sinon SECURITY_ALERT_EMAIL, sinon SUPPORT_EMAIL — même logique
 * que security-alerting.ts, avec un repli pour ne jamais alerter dans le vide)
 * : totaux, taux, les 10 adresses en cause avec l'entreprise.
 *
 * Idempotent sans nouvelle table : le courriel d'alerte est lui-même
 * journalisé dans email_deliveries avec entity_type = 'alerte_rebonds' ; avant
 * d'envoyer, on vérifie qu'aucune ligne de ce type n'existe depuis minuit
 * local (redémarrage à 8 h, deux instances). Une garde mémoire évite même la
 * requête dans la même instance. Ces lignes sont exclues du calcul, et le
 * webhook ne les suit jamais (ENTITES_SANS_SUIVI).
 *
 * Même mécanique que support/resume-quotidien.ts : vérification toutes les
 * dix minutes, envoi dans la première tranche de l'heure cible. Pur et testé
 * (tests/courriels/sante.test.ts) : calcul, seuil, composition, destination.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail, isMailerConfigured } from '../mailer';
import { supportEmail } from '../config';
import { rendreCourrielLume, echapper } from './gabarit';
import { jourLocal, minuitLocal } from '../lumi/raccourcis';
import { logger } from '../logger';

export const HEURE_LOCALE_ALERTE = 8;
export const FUSEAU_ALERTE = 'America/Montreal';
export const SEUIL_TAUX = 0.02;
export const MINIMUM_ENVOIS = 20;
export const ENTITE_ALERTE = 'alerte_rebonds';
export const MAX_ADRESSES = 10;
const CADENCE_MS = 10 * 60_000;
const FENETRE_MS = 24 * 3_600_000;
const MAX_LIGNES_LUES = 5000;

export interface LigneEnvoi {
  org_id: string | null;
  to_email: string;
  status: string;
  entity_type: string | null;
  created_at: string;
}

export interface SanteCourriels {
  total: number;
  nonLivres: number;
  plaintes: number;
  /** (nonLivres + plaintes) / total ; 0 sans envoi. */
  taux: number;
}

export interface AdresseEnCause { email: string; entreprise: string; statut: 'bounced' | 'complained'; quand: string }

/** Totaux et taux sur les lignes reçues. Les alertes elles-mêmes n'entrent pas dans le calcul. */
export function calculerSante(lignes: LigneEnvoi[]): SanteCourriels {
  const utiles = lignes.filter((l) => l.entity_type !== ENTITE_ALERTE);
  const nonLivres = utiles.filter((l) => l.status === 'bounced').length;
  const plaintes = utiles.filter((l) => l.status === 'complained').length;
  const total = utiles.length;
  return { total, nonLivres, plaintes, taux: total ? (nonLivres + plaintes) / total : 0 };
}

/** Strictement au-dessus de 2 %, et assez d'envois pour que ce soit un signal. */
export function doitAlerter(s: SanteCourriels): boolean {
  return s.total >= MINIMUM_ENVOIS && s.taux > SEUIL_TAUX;
}

/** Les adresses en cause, les plus récentes d'abord, avec le nom de l'entreprise. */
export function adressesEnCause(lignes: LigneEnvoi[], nomsOrgs: Map<string, string>, max = MAX_ADRESSES): AdresseEnCause[] {
  return lignes
    .filter((l): l is LigneEnvoi & { status: 'bounced' | 'complained' } => (l.status === 'bounced' || l.status === 'complained') && l.entity_type !== ENTITE_ALERTE)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, max)
    .map((l) => ({ email: l.to_email, entreprise: (l.org_id && nomsOrgs.get(l.org_id)) || 'Lume', statut: l.status, quand: l.created_at }));
}

/** « 3,1 % » — une décimale, virgule française. */
export function formaterTaux(taux: number): string {
  return `${(taux * 100).toFixed(1).replace('.', ',')} %`;
}

/** Sujet et corps du courriel à l'exploitant. Pur. */
export function composerAlerte(s: SanteCourriels, causes: AdresseEnCause[]): { sujet: string; html: string } {
  const taux = formaterTaux(s.taux);
  const sujet = `[Lume] Taux de rebond ${taux} sur 24 h`;
  const liste = causes.length
    ? `<p style="margin:0 0 8px;font-weight:600;">Adresses en cause (${Math.min(causes.length, MAX_ADRESSES)} plus récentes)</p><ul style="margin:0;padding-left:18px;">${causes.map((c) => `<li>${echapper(c.email)} — ${echapper(c.entreprise)} · ${c.statut === 'complained' ? 'plainte' : 'rebond'} · ${echapper(c.quand.slice(0, 16).replace('T', ' '))} UTC</li>`).join('')}</ul>`
    : '';
  const html = rendreCourrielLume({
    langue: 'fr',
    preheader: `${s.nonLivres + s.plaintes} courriel(s) sur ${s.total} non livrés ou signalés — ${taux}`,
    titre: `Taux de rebond ${taux} sur 24 h`,
    intro: `Au-dessus du seuil de ${formaterTaux(SEUIL_TAUX)}. Un domaine qui rebondit se fait classer en pourriel pour toutes les entreprises : à regarder aujourd'hui (adresses invalides saisies par un client, liste importée, domaine mal configuré).`,
    lignes: [
      { libelle: 'Envoyés (24 h)', valeur: String(s.total) },
      { libelle: 'Non livrés', valeur: String(s.nonLivres), fort: s.nonLivres > 0 },
      { libelle: 'Plaintes', valeur: String(s.plaintes), fort: s.plaintes > 0 },
      { libelle: 'Taux', valeur: taux, fort: true },
    ],
    corpsHtml: liste,
    note: 'Alerte automatique, une fois par jour à 8 h (Montréal), seulement au-dessus du seuil et avec au moins 20 envois. Détail complet dans email_deliveries.',
    signature: null,
  });
  return { sujet, html };
}

/** Où envoyer l'alerte : ALERT_EMAIL, sinon la même destination que les alertes de sécurité, sinon le support. */
export function destinationAlerte(env: NodeJS.ProcessEnv = process.env): string {
  return env.ALERT_EMAIL || env.SECURITY_ALERT_EMAIL || supportEmail;
}

/** Faut-il vérifier maintenant ? À l'heure locale cible, dans sa première tranche de dix minutes. */
export function doitEnvoyerMaintenant(maintenant: Date, fuseau = FUSEAU_ALERTE): boolean {
  const p = new Intl.DateTimeFormat('en-CA', { hourCycle: 'h23', hour: '2-digit', minute: '2-digit', timeZone: fuseau }).formatToParts(maintenant);
  const v = (t: string) => Number(p.find((x) => x.type === t)?.value ?? -1);
  return v('hour') === HEURE_LOCALE_ALERTE && v('minute') < CADENCE_MS / 60_000;
}

let dernierJourAlerte: string | null = null;

export async function verifierSanteCourriels(
  admin: SupabaseClient,
  maintenant = new Date(),
): Promise<'envoye' | 'sain' | 'deja' | 'sans-courriel' | 'erreur'> {
  const jour = jourLocal(FUSEAU_ALERTE, maintenant, 0);
  if (dernierJourAlerte === jour) return 'deja';
  try {
    const depuis = new Date(maintenant.getTime() - FENETRE_MS).toISOString();
    const { data, error } = await admin
      .from('email_deliveries')
      .select('org_id, to_email, status, entity_type, created_at')
      .gte('created_at', depuis)
      .order('created_at', { ascending: false })
      .limit(MAX_LIGNES_LUES);
    if (error) throw error;
    const lignes = (data ?? []) as LigneEnvoi[];
    const sante = calculerSante(lignes);
    logger.info('[courriels/sante] taux de rebond 24 h', { total: sante.total, nonLivres: sante.nonLivres, plaintes: sante.plaintes, taux: formaterTaux(sante.taux) });
    if (!doitAlerter(sante)) return 'sain';

    // Déjà alertée aujourd'hui (autre instance, redémarrage) ? La ligne de l'alerte fait foi.
    const { data: dejaEnvoyee, error: e2 } = await admin
      .from('email_deliveries')
      .select('id')
      .eq('entity_type', ENTITE_ALERTE)
      .gte('created_at', minuitLocal(jour, FUSEAU_ALERTE))
      .limit(1);
    if (e2) throw e2;
    if (dejaEnvoyee?.length) { dernierJourAlerte = jour; return 'deja'; }

    if (!isMailerConfigured()) {
      logger.error('[courriels/sante] taux de rebond au-dessus du seuil mais aucun fournisseur de courriel configuré', { taux: formaterTaux(sante.taux) });
      return 'sans-courriel';
    }

    const orgIds = [...new Set(lignes.filter((l) => l.status === 'bounced' || l.status === 'complained').map((l) => l.org_id).filter((x): x is string => !!x))];
    const nomsOrgs = new Map<string, string>();
    if (orgIds.length) {
      const { data: orgs, error: e3 } = await admin.from('orgs').select('id, name').in('id', orgIds.slice(0, 200));
      if (e3) throw e3;
      for (const o of orgs ?? []) nomsOrgs.set(String(o.id), String(o.name || ''));
    }

    const { sujet, html } = composerAlerte(sante, adressesEnCause(lignes, nomsOrgs));
    const destination = destinationAlerte();
    const resultat = await sendEmail({ to: destination, subject: sujet, html, suivi: { orgId: null, entityType: ENTITE_ALERTE, entityId: null } });
    if (!resultat.sent) throw new Error(resultat.error || 'envoi refusé');
    dernierJourAlerte = jour;
    logger.warn('[courriels/sante] alerte taux de rebond envoyée', { jour, taux: formaterTaux(sante.taux), total: sante.total });
    return 'envoye';
  } catch (e: any) {
    logger.error('[courriels/sante] vérification impossible', { error: e?.message || String(e) });
    return 'erreur';
  }
}

/** Vérifie toutes les dix minutes ; alerte au plus une fois par jour, à HEURE_LOCALE_ALERTE. */
export function demarrerSanteCourriels(admin: () => SupabaseClient): void {
  const t = setInterval(() => {
    if (!doitEnvoyerMaintenant(new Date())) return;
    void verifierSanteCourriels(admin());
  }, CADENCE_MS);
  t.unref?.();
  logger.info('[courriels/sante] alerte taux de rebond armée (8 h Montréal)', { destination: destinationAlerte() });
}
