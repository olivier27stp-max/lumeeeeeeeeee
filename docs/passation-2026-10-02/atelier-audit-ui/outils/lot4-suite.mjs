// Lot 4, suite : le relevé du test lit TOUS les littéraux d'une ligne « error: », et les causes vues en prod.
import { readFileSync, writeFileSync } from 'node:fs';
const racine = 'D:/lume-uiaudit/wt-lumi/';
const r = (s, a, b, quoi) => { if (!s.includes(a)) throw new Error('introuvable : ' + quoi); return s.replace(a, b); };

let t = readFileSync(racine + 'tests/automation/raisons-echec-traduites.test.ts', 'utf8');
t = r(t,
`    for (const m of source.matchAll(/error:\s*(?:'((?:[^'\\]|\\.)*)'|\`((?:[^\`\\]|\\.)*)\`)/g)) {
      const brut = (m[1] ?? m[2] ?? '').replace(/\\'/g, "'");
      if (brut.length < 8 || !ANGLAIS.test(brut) || FRANCAIS.test(brut)) continue;
      vus.add(brut.replace(/\$\{[^}]*\}/g, 'exemple'));
    }`,
`    // Toute la ligne : \`error: a ? 'X' : 'Y'\` ou \`error: [...].join(' / ') || 'Z'\` portent aussi des messages.
    for (const ligne of source.split('\n')) {
      if (!/\berror:/.test(ligne)) continue;
      for (const m of ligne.matchAll(/'((?:[^'\\]|\\.)*)'|\`((?:[^\`\\]|\\.)*)\`/g)) {
        const brut = (m[1] ?? m[2] ?? '').replace(/\\'/g, "'");
        if (brut.length < 8 || !ANGLAIS.test(brut) || FRANCAIS.test(brut)) continue;
        vus.add(brut.replace(/\$\{[^}]*\}/g, 'exemple'));
      }
    }`, 'boucle du relevé');
t = r(t,
`const messages = messagesAnglaisDuMoteur();`,
`/**
 * Les causes en anglais RÉELLEMENT présentes dans les journaux de prod (60 jours, relevé du 2026-10-01),
 * numéros et adresses retirés. Certaines viennent d'autres modules que le moteur (fournisseur de textos)
 * ou d'anciennes versions : elles restent dans les journaux, donc à l'écran.
 */
const VUES_EN_PROD = [
  'Frequency cap reached for +15145550000 (max 3 commercial messages / 24h) — skipped to avoid spamming',
  'Twilio not configured',
  'A review request was already sent to this client in the last 7 days.',
  'No recipient email',
  'No recipient phone',
  'Table not allowed for update_status: memberships',
  'Review request could not be sent',
  'Organization has no SMS number provisioned (sms_not_provisioned)',
  'Review requests are disabled in Company Settings.',
  'Review requests are disabled in Settings → Customer reviews.',
];

const messages = [...new Set([...messagesAnglaisDuMoteur(), ...VUES_EN_PROD])];`, 'liste des messages');
writeFileSync(racine + 'tests/automation/raisons-echec-traduites.test.ts', t);

let s = readFileSync(racine + 'src/lib/automationJournauxApi.ts', 'utf8');
s = r(s,
`    ['already sent to this client', 'une demande d’avis a déjà été envoyée à ce client dans les 7 derniers jours', 'this client already got a review request in the last 7 days'],`,
`    ['already sent to this client', 'une demande d’avis a déjà été envoyée à ce client dans les 7 derniers jours', 'this client already got a review request in the last 7 days'],
    ['could not be sent', 'la demande d’avis n’a pas pu être envoyée', 'the review request did not go out'],`, 'paires');
s = r(s,
`  if (e.includes('review link')) return fr ? 'Aucun lien d’avis Google ou Facebook n’est configuré.' : 'No Google or Facebook review link is set up.';
  if (e.includes('opted out')`,
`  if (e.includes('could not be sent')) return fr ? 'La demande d’avis n’a pas pu être envoyée.' : 'The review request did not go out.';
  if (e.includes('review link')) return fr ? 'Aucun lien d’avis Google ou Facebook n’est configuré.' : 'No Google or Facebook review link is set up.';
  if (e.includes('opted out')`, 'liste');
writeFileSync(racine + 'src/lib/automationJournauxApi.ts', s);
console.log('ok');
