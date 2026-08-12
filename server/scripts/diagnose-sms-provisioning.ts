/**
 * Diagnostic du provisionnement SMS — SANS RIEN ACHETER.
 *
 * Usage :
 *   npx tsx server/scripts/diagnose-sms-provisioning.ts
 *
 * Répond à la question « est-ce qu'un nouveau client recevra son numéro ? »
 * sans créer d'org, sans souscrire de forfait et sans dépenser un dollar.
 *
 * Contrairement à `test-twilio-provisioning.ts`, ce script ACHÈTE RIEN : il
 * s'arrête juste avant l'achat, à l'étape où Twilio confirme qu'un numéro est
 * disponible. C'est la dernière vérification possible sans transaction.
 *
 * Vérifie, dans l'ordre où le code réel les rencontre :
 *   1. les identifiants Twilio ;
 *   2. l'URL publique des webhooks (le garde qui bloque tout si absente) ;
 *   3. la connexion effective au compte Twilio et son solde ;
 *   4. la disponibilité réelle de numéros SMS au Canada et aux États-Unis ;
 *   5. l'état des orgs en base : qui a un numéro, qui devrait en avoir un ;
 *   6. le câblage du code (les deux parcours d'abonnement provisionnent-ils ?).
 */

import 'dotenv/config';
import { twilioClient, twilioAccountSid, getTwilioStatusCallbackUrl } from '../lib/config';
import { getServiceClient } from '../lib/supabase';

const ok = (m: string) => console.log(`  ✅ ${m}`);
const ko = (m: string) => console.log(`  ❌ ${m}`);
const warn = (m: string) => console.log(`  ⚠️  ${m}`);
const info = (m: string) => console.log(`     ${m}`);
const titre = (m: string) => console.log(`\n━━ ${m} ${'━'.repeat(Math.max(0, 56 - m.length))}`);

let bloquants = 0;

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  Diagnostic du provisionnement SMS — aucun achat         ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  // ── 1. Identifiants Twilio ────────────────────────────────────────
  titre('1. Identifiants Twilio');
  if (!twilioClient) {
    ko('Client Twilio non initialisé.');
    info('TWILIO_ACCOUNT_SID (doit commencer par « AC ») et TWILIO_AUTH_TOKEN');
    info('doivent être définis. Sans eux, aucun numéro ne peut être acheté.');
    bloquants++;
  } else {
    ok(`Client initialisé (compte ${twilioAccountSid.slice(0, 8)}…)`);
  }

  // ── 2. URL publique des webhooks ──────────────────────────────────
  // C'est le garde le plus souvent en cause : provisionSmsNumber refuse
  // d'acheter un numéro dont les webhooks pointeraient vers du vide.
  titre('2. URL publique des webhooks');
  const publicUrl = (process.env.PUBLIC_URL || process.env.TWILIO_WEBHOOK_BASE_URL || '')
    .trim().replace(/\/$/, '');

  if (!publicUrl) {
    ko('Ni PUBLIC_URL ni TWILIO_WEBHOOK_BASE_URL n’est défini.');
    info('Le provisionnement s’arrêtera ici, avant même de contacter Twilio.');
    bloquants++;
  } else if (!/^https?:\/\//.test(publicUrl)) {
    ko(`URL invalide (doit commencer par https://) : ${publicUrl}`);
    bloquants++;
  } else if (publicUrl.includes('localhost')) {
    ko(`URL locale — Twilio ne peut pas la joindre : ${publicUrl}`);
    info('Il faut l’URL publique de production.');
    bloquants++;
  } else if (publicUrl.startsWith('http://')) {
    warn(`URL en http:// et non https:// : ${publicUrl}`);
    info('Le provisionnement passera, mais Twilio exige https en pratique.');
  } else {
    ok(`URL des webhooks : ${publicUrl}`);
    info(`Réception des SMS   : ${publicUrl}/api/messages/inbound`);
    info(`Accusés de réception : ${publicUrl}/api/messages/status`);
  }

  // Cohérence avec le suivi de livraison (helper séparé, autres variables).
  const cb = getTwilioStatusCallbackUrl();
  if (cb) ok(`Suivi de livraison actif : ${cb}`);
  else warn('Suivi de livraison inactif — les SMS resteront au statut « envoyé ».');

  // ── 3. Connexion réelle au compte ─────────────────────────────────
  titre('3. Connexion au compte Twilio');
  if (twilioClient) {
    try {
      const acct = await twilioClient.api.accounts(twilioAccountSid).fetch();
      ok(`Compte joignable : ${acct.friendlyName} (statut : ${acct.status})`);
      if (acct.status !== 'active') {
        ko(`Le compte n’est pas actif (${acct.status}) — aucun achat possible.`);
        bloquants++;
      }
      if (acct.type === 'Trial') {
        warn('Compte en mode ESSAI : l’achat de numéros est restreint.');
        info('Il faudra créditer le compte avant un vrai lancement.');
      }
      try {
        const bal: any = await (twilioClient as any).balance.fetch();
        const montant = Number(bal.balance);
        if (montant < 2) {
          ko(`Solde insuffisant : ${bal.balance} ${bal.currency} (un numéro coûte ~1 $/mois)`);
          bloquants++;
        } else {
          ok(`Solde : ${bal.balance} ${bal.currency}`);
        }
      } catch {
        info('Solde non lisible (permission API) — à vérifier dans la console Twilio.');
      }
    } catch (err: any) {
      ko(`Connexion refusée : ${err?.message}`);
      info('Identifiants invalides ou révoqués.');
      bloquants++;
    }
  } else {
    info('Ignoré — pas de client Twilio.');
  }

  // ── 4. Disponibilité réelle de numéros ────────────────────────────
  // Dernière étape avant l'achat : si Twilio propose un numéro ici, le
  // provisionnement réel aboutira.
  titre('4. Numéros disponibles (recherche seule, aucun achat)');
  if (twilioClient) {
    for (const [pays, indicatif] of [['CA', '514'], ['CA', undefined], ['US', undefined]] as const) {
      try {
        const params: Record<string, any> = { limit: 1, smsEnabled: true };
        if (indicatif) params.areaCode = indicatif;
        const dispo = await twilioClient.availablePhoneNumbers(pays).local.list(params);
        const libelle = indicatif ? `${pays} (indicatif ${indicatif})` : `${pays} (tout le pays)`;
        if (dispo.length > 0) ok(`${libelle} : disponible — ex. ${dispo[0].phoneNumber}`);
        else warn(`${libelle} : aucun numéro disponible`);
      } catch (err: any) {
        const libelle = indicatif ? `${pays}/${indicatif}` : pays;
        ko(`${libelle} : ${err?.message}`);
        if (err?.code === 20003) info('→ Identifiants sans permission sur cette ressource.');
      }
    }
  } else {
    info('Ignoré — pas de client Twilio.');
  }

  // ── 5. État des orgs en base ──────────────────────────────────────
  titre('5. Orgs en base');
  try {
    const admin = getServiceClient();
    const { data: abos } = await admin
      .from('subscriptions')
      .select('org_id, status, plans!inner(slug, includes_sms)')
      .in('status', ['active', 'trialing']);

    const { data: canaux } = await admin
      .from('communication_channels')
      .select('org_id')
      .eq('channel_type', 'sms')
      .eq('status', 'active');

    const avecNumero = new Set((canaux || []).map((c: any) => c.org_id));
    const eligibles = (abos || []).filter((s: any) => s.plans?.includes_sms);
    const manquants = eligibles.filter((s: any) => !avecNumero.has(s.org_id));

    info(`Abonnements actifs        : ${abos?.length ?? 0}`);
    info(`Dont forfait avec SMS     : ${eligibles.length}`);
    info(`Possèdent un numéro       : ${eligibles.length - manquants.length}`);
    if (manquants.length > 0) {
      warn(`Éligibles SANS numéro     : ${manquants.length}`);
      info('Ces orgs se sont abonnées avant le correctif. Elles n’obtiendront pas');
      info('de numéro rétroactivement : il faut le demander depuis');
      info('Réglages → Messagerie, ou les recréer.');
      for (const m of manquants) info(`  · ${m.org_id} (${(m as any).plans?.slug})`);
    } else if (eligibles.length > 0) {
      ok('Toutes les orgs éligibles ont un numéro.');
    }

    const { data: evts } = await admin
      .from('provisioning_events')
      .select('status, error_message, created_at')
      .order('created_at', { ascending: false })
      .limit(5);

    if (!evts || evts.length === 0) {
      warn('Aucune tentative de provisionnement enregistrée à ce jour.');
      info('Attendu tant qu’aucun abonnement n’a eu lieu depuis le correctif.');
    } else {
      info(`Dernières tentatives (${evts.length}) :`);
      for (const e of evts) {
        const d = String(e.created_at).slice(0, 10);
        if (e.status === 'success') ok(`  ${d} — succès`);
        else ko(`  ${d} — ${e.status} : ${e.error_message || 'sans détail'}`);
      }
    }
  } catch (err: any) {
    ko(`Lecture de la base impossible : ${err?.message}`);
  }

  // ── 6. Câblage du code ────────────────────────────────────────────
  titre('6. Câblage du code');
  try {
    const lib = await import('../lib/twilioProvisioning');
    if (typeof (lib as any).provisionSmsForNewSubscription === 'function') {
      ok('Fonction partagée disponible pour les deux parcours d’abonnement.');
    } else {
      ko('provisionSmsForNewSubscription introuvable.');
      bloquants++;
    }
  } catch (err: any) {
    ko(`Module de provisionnement illisible : ${err?.message}`);
    bloquants++;
  }

  // ── Verdict ───────────────────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  if (bloquants === 0) {
    console.log('║  ✅ VERDICT : un nouvel abonné recevra son numéro.       ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
    console.log('\nToute la chaîne répond. Le prochain abonnement sur un forfait');
    console.log('incluant les SMS déclenchera l’achat automatiquement.\n');
  } else {
    console.log(`║  ❌ VERDICT : ${bloquants} problème(s) bloquant(s).                     ║`);
    console.log('╚══════════════════════════════════════════════════════════╝');
    console.log('\nTant qu’ils ne sont pas réglés, aucun numéro ne sera acheté.');
    console.log('L’échec sera toutefois tracé dans `provisioning_events`.\n');
  }
  process.exit(bloquants === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nErreur inattendue :', err?.message || err);
  process.exit(1);
});
