// Passe prod, lot 1b (PR #866) : vérifie sur lumecrm.net, bureau de test en bac à sable.
import { ouvrir, capture, ORG } from '../nav-prod.mjs';

const o = await ouvrir({});
const { page, m } = o;
let ok = 0; let total = 0;
const verifier = async (nom, f) => {
  total += 1;
  try { const d = await f(); ok += 1; console.log(`✓ ${nom} — ${d}`); }
  catch (e) { console.log(`✗ ${nom} : ${String(e).split('\n')[0].slice(0, 300)}`); await capture(page, `p5-echec-${nom}`); }
};
const exiger = (c, msg) => { if (!c) throw new Error(msg); };

try {
  await verifier('diagnostic-sans-identifiants', async () => {
    const r = await fetch('https://lumecrm.net/api/automations/test', {
      headers: { Authorization: `Bearer ${o.jeton}`, 'x-org-id': ORG, 'x-requested-with': 'XMLHttpRequest' },
    });
    const brut = await r.text();
    exiger(r.status === 200, `statut ${r.status} : ${brut.slice(0, 120)}`);
    const j = JSON.parse(brut);
    const twilio = j.results.find((x) => x.name === 'Twilio SMS configured');
    const smtp = j.results.find((x) => x.name === 'SMTP email configured');
    exiger(!/SID=|Phone=\+|SMTP user:/.test(brut), `identifiants encore présents : ${twilio?.details} / ${smtp?.details}`);
    exiger(!/\+1\d{10}/.test(`${twilio?.details} ${smtp?.details}`), 'numéro de téléphone dans le détail');
    return `Twilio : « ${twilio?.details} » ; SMTP : « ${smtp?.details} »`;
  });

  await page.goto('https://lumecrm.net/automations', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /^Actions pour / }).first().waitFor({ timeout: 60_000 });
  await o.temoins();

  await verifier('pas-de-fausse-alerte-variable', async () => {
    const voir = page.getByRole('button', { name: /^Voir les messages de Confirmation de rendez-vous/ });
    await voir.first().scrollIntoViewIfNeeded();
    await voir.first().click();
    await page.getByText('Courriel envoyé au client').first().waitFor({ timeout: 10_000 });
    await page.getByText('Courriel envoyé au client').first().locator('xpath=ancestor::div[2]').getByRole('button', { name: /^Modifier$/ }).click();
    await page.getByTestId('palette-variables').waitFor({ timeout: 10_000 });
    await page.waitForTimeout(800);
    const saisi = (await page.locator('textarea').evaluateAll((els) => els.map((e) => e.value))).join(' | ');
    const texte = saisi + ' ' + await page.locator('body').innerText();
    await capture(page, 'p5-01-editeur-sans-fausse-alerte');
    exiger(/\[appointment_address\]/.test(texte), 'le texte ne contient plus [appointment_address] : cas non rejoué');
    exiger(!/Cette variable n’existe pas|Ces variables n’existent pas/.test(texte), 'la fausse alerte est encore là');
    return 'le courriel fourni cite [appointment_address] sans alerte';
  });
} finally {
  console.log('MONITEUR : console', m.console.length, '| exceptions', m.exceptions.length, '| réseau >=400', m.reseau.length, '| échecs', m.echecs.length);
  await o.fermer();
  console.log(`BILAN : ${ok}/${total}`);
}
