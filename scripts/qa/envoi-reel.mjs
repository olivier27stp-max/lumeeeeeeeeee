#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   L'ENVOI RÉEL — un vrai texto, un vrai courriel, sur ton appareil.

   Tout le reste a été vérifié en laboratoire : le moteur s'arme, les
   variables se résolvent, le filet détourne. Il manque la dernière
   preuve — qu'un message part vraiment et arrive.

   POURQUOI ÇA N'A JAMAIS PU SE FAIRE
   Aucune clé Twilio ni SMTP n'existe en local (vérifié le 2026-09-01).
   Le moteur se déclenche, prépare son message… et s'arrête faute de
   moyen d'envoyer. C'est exactement ce que décrit
   scripts/test-parcours-contrat.mjs.

   CE QU'IL FAUT POUR LE LANCER
   Ajouter dans .env.local — jamais dans le chat, jamais dans un
   commit (règle 7 du CLAUDE.md) :

       TWILIO_ACCOUNT_SID=AC…
       TWILIO_AUTH_TOKEN=…
       TWILIO_PHONE_NUMBER=+1…
       SMTP_USER=…            (facultatif, pour le courriel)
       SMTP_PASS=…

   Le filet QA_REDIRECT_TO reste armé : même avec de vraies clés, tout
   message part vers TON numéro, avec le destinataire d'origine en
   tête. Aucun client ne peut rien recevoir.

   Usage : npm run qa:envoi-reel
   ═══════════════════════════════════════════════════════════════ */

import { createClient } from '@supabase/supabase-js';

const URL_SB = process.env.VITE_SUPABASE_URL;
const CLE_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const API = `http://localhost:${process.env.API_PORT || 3002}`;

if (process.env.SUPABASE_PROJECT_REF_PROD && URL_SB?.includes(process.env.SUPABASE_PROJECT_REF_PROD)) {
  console.error('REFUS : ce banc envoie de vrais messages. La cible est la PRODUCTION.');
  process.exit(2);
}

const filet = (process.env.QA_REDIRECT_TO || '').trim();
if (!filet) {
  console.error('\nREFUS : le filet n\'est pas armé (QA_REDIRECT_TO absent).');
  console.error('Sans lui, un message pourrait partir vers un vrai client.\n');
  process.exit(2);
}

/* ── De quoi dispose-t-on vraiment ? ─────────────────────────── */

const sid = (process.env.TWILIO_ACCOUNT_SID || '').trim();
const jetonTwilio = (process.env.TWILIO_AUTH_TOKEN || '').trim();
const numero = (process.env.TWILIO_PHONE_NUMBER || '').trim();
const smtpUser = (process.env.SMTP_USER || '').trim();

const smsPret = Boolean(sid && jetonTwilio && numero && sid.startsWith('AC'));
const courrielPret = Boolean(smtpUser && (process.env.SMTP_PASS || '').trim());

console.log('\n═══ Envoi réel — la dernière preuve ═══\n');
console.log(`  Filet armé   : tout part vers ${filet}`);
console.log(`  SMS          : ${smsPret ? 'configuré' : 'PAS de clés Twilio'}`);
console.log(`  Courriel     : ${courrielPret ? 'configuré' : 'PAS de clés SMTP'}`);

if (!smsPret && !courrielPret) {
  console.log('\n  Rien à envoyer : aucun canal n\'est configuré en local.');
  console.log('');
  console.log('  Pour faire partir un vrai message, ajouter dans .env.local :');
  console.log('    TWILIO_ACCOUNT_SID=AC…');
  console.log('    TWILIO_AUTH_TOKEN=…');
  console.log('    TWILIO_PHONE_NUMBER=+1…');
  console.log('');
  console.log('  Le filet restera armé : le message arrivera sur ton appareil,');
  console.log('  jamais chez un client.\n');
  process.exit(0);
}

/* ── L'envoi ─────────────────────────────────────────────────── */

const admin = createClient(URL_SB, CLE_SERVICE, { auth: { persistSession: false } });
const ORG = process.env.QA_ORG || 'eeda2ab3-08df-4fce-82e1-3aa9b7d833cf';

// Un numéro volontairement faux : s'il apparaît en tête du message reçu,
// c'est la preuve que le filet a bien détourné plutôt que laissé passer.
const FAUX_CLIENT = '+15145550199';
const marqueur = `QA-${Date.now().toString(36).slice(-5)}`;

const { data: lien } = await admin.auth.admin.generateLink({
  type: 'magiclink', email: process.env.QA_COMPTE || 'willhebert30@gmail.com',
});
const anon = createClient(URL_SB, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const { data: sess } = await anon.auth.verifyOtp({
  token_hash: lien.properties.hashed_token, type: 'magiclink',
});

console.log('\n  Envoi en cours…\n');

// `POST /api/workflows/execute-action` exécute une action isolée : c'est le
// chemin le plus direct pour éprouver un envoi sans monter tout un scénario.
const rep = await fetch(`${API}/api/workflows/execute-action`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${sess.session.access_token}`,
    'x-org-id': ORG,
  },
  body: JSON.stringify({
    action_type: 'send_sms',
    config: {
      to: FAUX_CLIENT,
      message: `Bonjour, votre rendez-vous est confirmé pour demain 9 h. [${marqueur}]`,
    },
    context: { entityType: 'job', entityId: null },
  }),
}).catch((e) => ({ ok: false, status: 0, err: e.message }));

const corps = rep.json ? await rep.json().catch(() => ({})) : {};

console.log(`  destinataire annoncé : ${FAUX_CLIENT}  (client fictif)`);
console.log(`  réponse du serveur   : HTTP ${rep.status}`);
if (corps?.error) console.log(`  message              : ${String(corps.error).slice(0, 110)}`);

if (rep.ok) {
  console.log('');
  console.log('  ✓ Le message est parti.');
  console.log('');
  console.log(`  Regarde ton téléphone (${filet}). Tu devrais recevoir :`);
  console.log(`      [QA → +1514…0199] Bonjour, votre rendez-vous est confirmé…`);
  console.log('');
  console.log('  Le préfixe prouve deux choses à la fois :');
  console.log('    • le message est bien parti par le vrai chemin d\'envoi ;');
  console.log(`    • il a été détourné — ${FAUX_CLIENT} n'a rien reçu.`);
} else {
  console.log('');
  console.log('  ✗ L\'envoi n\'a pas abouti. Le refus est-il légitime ?');
  const m = String(corps?.error || '').toLowerCase();
  if (m.includes('not configured')) console.log('    → aucune clé Twilio : attendu en local.');
  else if (m.includes('plan')) console.log('    → le forfait de cette organisation n\'inclut pas les SMS.');
  else if (m.includes('provision')) console.log('    → aucun numéro SMS provisionné pour cette organisation.');
  else console.log('    → cause inattendue, à examiner.');
}
console.log('');
