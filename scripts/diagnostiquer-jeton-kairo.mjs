#!/usr/bin/env node
/**
 * Dit pourquoi un jeton Kairo est refusé — sans deviner.
 *
 * `BAD_SIGNATURE` couvre trois causes très différentes, et le message renvoyé
 * au client reste volontairement vague pour ne pas aider à forger un jeton.
 * Cet outil tourne EN LOCAL, avec le secret : il peut donc dire laquelle des
 * trois c'est, au lieu de laisser essayer au hasard.
 *
 * USAGE
 *   node scripts/diagnostiquer-jeton-kairo.mjs "<le jeton complet>"
 *
 * Le jeton est la valeur après `token=` dans l'URL. Il ne contient PAS le
 * secret — seulement le contenu signé et la signature.
 */
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';

const jeton = process.argv[2];
if (!jeton) {
  console.error('Usage : node scripts/diagnostiquer-jeton-kairo.mjs "<jeton>"');
  console.error('Le jeton est la valeur après `token=` dans l\'URL du lien Kairo.');
  process.exit(2);
}

const env = readFileSync('.env.local', 'utf8');
const m = /^KAIRO_LUME_HANDOFF_SECRET=(.*)$/m.exec(env);
if (!m) {
  console.error('KAIRO_LUME_HANDOFF_SECRET absent de .env.local');
  process.exit(2);
}
const secret = m[1].trim();

const ok = (t) => console.log('  ✓ ' + t);
const ko = (t) => console.log('  ✗ ' + t);

console.log('\nJETON REÇU');
console.log('  longueur :', jeton.length, 'caractères');

const sep = jeton.lastIndexOf('.');
if (sep <= 0 || sep === jeton.length - 1) {
  ko('format : attendu `corps.signature`, séparés par un point');
  console.log('\n  → Kairo ne produit pas la bonne forme de jeton.');
  process.exit(1);
}
const corpsB64 = jeton.slice(0, sep);
const sigRecue = jeton.slice(sep + 1);
ok('format `corps.signature`');

// ── Le corps ──
console.log('\nCORPS');
let charge;
try {
  const brut = Buffer.from(corpsB64, 'base64url').toString('utf8');
  charge = JSON.parse(brut);
  ok('décodable en base64url, JSON valide');
  console.log('    ' + JSON.stringify(charge));
} catch {
  ko('illisible — le corps doit être du base64url d\'un JSON');
  // Le piège classique : base64 standard au lieu de base64url.
  try {
    JSON.parse(Buffer.from(corpsB64, 'base64').toString('utf8'));
    console.log('\n  → CAUSE TROUVÉE : le corps est en base64 STANDARD.');
    console.log('    Kairo doit utiliser base64URL : `-` et `_` au lieu de `+` et `/`,');
    console.log('    et sans le remplissage `=` à la fin.');
  } catch { /* ni l'un ni l'autre */ }
  process.exit(1);
}

// Le padding et les caractères non-url passent le décodage mais changent la
// chaîne signée : c'est une cause fréquente de signature qui ne correspond pas.
if (/[+/=]/.test(corpsB64)) {
  ko('le corps contient `+`, `/` ou `=` — ce n\'est pas du base64url strict');
  console.log('    Or c\'est CETTE chaîne qui est signée : sa forme fait partie de la preuve.');
}

// ── La signature ──
console.log('\nSIGNATURE');
const attendue = crypto.createHmac('sha256', secret).update(corpsB64).digest();

const candidats = [];
if (/^[0-9a-f]{64}$/i.test(sigRecue)) candidats.push(['hexadécimal', Buffer.from(sigRecue, 'hex')]);
else {
  candidats.push(['base64url', Buffer.from(sigRecue, 'base64url')]);
  if (/[+/=]/.test(sigRecue)) candidats.push(['base64 standard', Buffer.from(sigRecue, 'base64')]);
}

const correspond = candidats.find(
  ([, b]) => b.length === attendue.length && crypto.timingSafeEqual(b, attendue),
);

if (correspond) {
  ok(`valide (encodage : ${correspond[0]})`);
  console.log('\n  → La signature est BONNE. Si la production refuse quand même,');
  console.log('    le secret posé sur Railway diffère de celui de .env.local.');
} else {
  ko('ne correspond pas au HMAC attendu');
  console.log('    reçue  :', sigRecue.slice(0, 50) + (sigRecue.length > 50 ? '…' : ''));
  console.log('    encodage détecté :', candidats.map(([n]) => n).join(' ou '));

  // On teste les erreurs d'implémentation connues pour nommer la cause.
  const brut = Buffer.from(corpsB64, 'base64url').toString('utf8');
  const essais = [
    ['le HMAC est calculé sur le JSON BRUT au lieu de la chaîne base64url',
      crypto.createHmac('sha256', secret).update(brut).digest()],
    ['le secret côté Kairo porte un retour à la ligne parasite',
      crypto.createHmac('sha256', secret + '\n').update(corpsB64).digest()],
    ['le secret côté Kairo porte une espace en fin',
      crypto.createHmac('sha256', secret + ' ').update(corpsB64).digest()],
    ['le secret côté Kairo est entouré de guillemets',
      crypto.createHmac('sha256', `"${secret}"`).update(corpsB64).digest()],
    ['le HMAC est calculé sur le jeton entier',
      crypto.createHmac('sha256', secret).update(jeton).digest()],
  ];

  let trouve = false;
  for (const [nom, att] of essais) {
    for (const [, recue] of candidats) {
      if (recue.length === att.length && crypto.timingSafeEqual(recue, att)) {
        console.log(`\n  → CAUSE TROUVÉE : ${nom}.`);
        trouve = true;
        break;
      }
    }
    if (trouve) break;
  }

  if (!trouve) {
    console.log('\n  → CAUSE LA PLUS PROBABLE : le secret de Kairo n\'est pas le même.');
    console.log('    Aucune erreur d\'encodage connue ne reproduit cette signature.');
    console.log('    Comparer les 64 caractères des deux côtés, sans guillemets');
    console.log('    ni retour à la ligne.');
  }

  console.log('\n  CE QUE KAIRO AURAIT DÛ PRODUIRE POUR CE CORPS :');
  console.log('    base64url :', attendue.toString('base64url'));
  console.log('    hex       :', attendue.toString('hex'));
}

// ── Le reste du contenu ──
console.log('\nCONTENU');
const maintenant = Math.floor(Date.now() / 1000);
const DESTINATIONS = ['/invoices/', '/jobs/', '/clients/', '/deals/', '/quotes/', '/messages/', '/leads/'];

charge.iss === 'kairo' ? ok('iss = kairo') : ko(`iss = ${JSON.stringify(charge.iss)} — attendu "kairo"`);
charge.jti ? ok('jti présent') : ko('jti manquant');
typeof charge.email === 'string' && charge.email.includes('@')
  ? ok(`email : ${charge.email}`) : ko('email manquant ou invalide');
charge.lume_org_id ? ok(`lume_org_id : ${charge.lume_org_id}`) : ko('lume_org_id manquant');

if (typeof charge.exp !== 'number') ko('exp manquant ou non numérique');
else if (charge.exp < maintenant) ko(`expiré depuis ${maintenant - charge.exp} s`);
else ok(`valide encore ${charge.exp - maintenant} s`);

const t = charge.target;
if (typeof t !== 'string') ko('target manquant');
else if (t.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(t)) ko(`target absolu refusé : ${t}`);
else if (!DESTINATIONS.some((p) => t.startsWith(p))) {
  ko(`target hors liste : ${t}`);
  console.log('    autorisés :', DESTINATIONS.join(' '));
} else ok(`target : ${t}`);

console.log('');
