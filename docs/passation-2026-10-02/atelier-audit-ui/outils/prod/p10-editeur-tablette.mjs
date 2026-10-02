// Passe prod, tablette : l'ÉDITEUR sur iPad (paysage, portrait) et sur bureau, avec un vrai parcours.
// Crée UN brouillon de test (jamais publié, bureau en bac à sable), l'ouvre, mesure, puis le retire par identifiant.
import { writeFileSync } from 'node:fs';
import { ouvrir, capture, inventaire, admin, ORG } from '../nav-prod.mjs';

const IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const CONFIGS = [
  { nom: 'ipad-paysage', navigateur: 'webkit', viewport: { width: 1024, height: 768 }, tactile: true, userAgent: IPAD },
  { nom: 'ipad-portrait', navigateur: 'webkit', viewport: { width: 768, height: 1024 }, tactile: true, userAgent: IPAD },
  { nom: 'bureau', navigateur: 'chromium', viewport: { width: 1440, height: 900 } },
];
const seule = process.argv[2];

const steps = [
  { id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'Bonjour [client_first_name], merci de votre demande.' } }, suivant: 'e2' },
  { id: 'e2', type: 'attendre', delai_secondes: 86400, suivant: 'e3' },
  { id: 'e3', type: 'action', action: { type: 'send_email', config: { subject: 'Suite à votre demande', body: '<p>Bonjour [client_first_name],</p><p>Nous revenons vers vous.</p>' } }, suivant: 'e4' },
  { id: 'e4', type: 'attendre', delai_secondes: 172800, suivant: 'e5' },
  { id: 'e5', type: 'action', action: { type: 'create_task', config: { title: 'Rappeler [client_name]' } }, suivant: null },
];
const { data: regle, error } = await admin.from('automation_rules').insert({
  org_id: ORG, name: '[QA-UI p10] parcours tablette', trigger_event: 'lead.created', conditions: {}, delay_seconds: 0,
  actions: [{ type: 'send_sms', config: steps[0].action.config }], steps, is_active: false,
}).select('id').single();
if (error) throw new Error(`création du brouillon de test : ${error.message}`);
console.log('brouillon de test :', regle.id);

const bilan = [];
try {
  for (const cfg of CONFIGS) {
    if (seule && cfg.nom !== seule) continue;
    const o = await ouvrir({ navigateur: cfg.navigateur, viewport: cfg.viewport, tactile: cfg.tactile, userAgent: cfg.userAgent, delai: 30_000 });
    const { page, m } = o;
    const noter = (etape, okk, detail) => { bilan.push({ config: cfg.nom, etape, ok: okk, detail }); console.log(`${okk ? '✓' : '✗'} ${cfg.nom} · ${etape} — ${detail}`); };
    const mesurer = async (zone) => {
      const inv = await inventaire(page, zone);
      const vis = inv.elements.filter((e) => !e.desactive);
      return {
        defX: inv.defilementX,
        horsX: vis.filter((e) => e.debordeX).map((e) => `${e.nom.slice(0, 30) || e.tag} (x=${e.x},l=${e.l})`),
        petites: cfg.tactile ? vis.filter((e) => e.dansEcran && (e.l < 28 || e.h < 28) && !(e.tag === 'input' && e.type === 'checkbox')).map((e) => `${e.nom.slice(0, 26) || e.tag} ${e.l}×${e.h}`) : [],
      };
    };
    try {
      await page.goto(`https://lumecrm.net/automations/${regle.id}`, { waitUntil: 'domcontentloaded' });
      await page.getByText('Créer une tâche').first().waitFor({ timeout: 60_000 });
      await o.temoins();
      await page.waitForTimeout(1000);
      await capture(page, `p10-${cfg.nom}-1-canevas`);
      let r = await mesurer('body');
      noter('canevas', !r.defX && r.horsX.length === 0, `défilement horizontal : ${r.defX ? 'OUI' : 'non'} ; hors écran : ${r.horsX.join(' | ') || 'rien'}${r.petites.length ? ` ; petites cibles : ${r.petites.slice(0, 8).join(' | ')}` : ''}`);

      // Ouvrir une étape : le panneau doit tenir, ses boutons être atteignables.
      await page.getByText('Créer une tâche').first().click();
      const enregistrer = page.getByRole('button', { name: /^Enregistrer$/ }).first();
      await enregistrer.waitFor({ timeout: 10_000 });
      await page.waitForTimeout(500);
      await capture(page, `p10-${cfg.nom}-2-panneau-etape`);
      const b = await enregistrer.boundingBox();
      const vue = page.viewportSize();
      const annuler = await page.getByRole('button', { name: /^Annuler$/ }).first().boundingBox();
      r = await mesurer('body');
      const tient = b && b.x >= 0 && b.x + b.width <= vue.width && annuler && annuler.x >= 0;
      noter('panneau-etape', !!tient && !r.defX, `« Enregistrer » à x=${Math.round(b?.x ?? -1)}→${Math.round((b?.x ?? 0) + (b?.width ?? 0))} / ${vue.width} ; défilement horizontal : ${r.defX ? 'OUI' : 'non'} ; hors écran : ${r.horsX.slice(0, 6).join(' | ') || 'rien'}`);
      await page.getByRole('button', { name: /^Annuler$/ }).first().click().catch(() => undefined);
      await page.waitForTimeout(400);

      // La carte « Quand » : un seul panneau.
      await page.getByText('Nouveau prospect').first().click();
      await page.waitForTimeout(700);
      await capture(page, `p10-${cfg.nom}-3-panneau-quand`);
      const nbEnregistrer = await page.getByRole('button', { name: /^Enregistrer$/ }).count();
      r = await mesurer('body');
      noter('panneau-quand', nbEnregistrer <= 1 && !r.defX && r.horsX.length === 0, `${nbEnregistrer} panneau(x) ouvert(s) ; hors écran : ${r.horsX.slice(0, 6).join(' | ') || 'rien'}`);
      const fermer = page.getByRole('button', { name: /^(Annuler|Fermer)$/ }).first();
      if (await fermer.count()) await fermer.click().catch(() => undefined);
      await page.waitForTimeout(400);

      // Le tiroir d'étapes.
      await page.getByRole('button', { name: /^Ajouter$/ }).first().click();
      const recherche = page.getByPlaceholder(/Rechercher/).last();
      await recherche.waitFor({ timeout: 8_000 });
      await page.waitForTimeout(500);
      await capture(page, `p10-${cfg.nom}-4-tiroir`);
      r = await mesurer('body');
      const rb = await recherche.boundingBox();
      noter('tiroir', !!rb && rb.x >= 0 && rb.x + rb.width <= vue.width && !r.defX, `recherche à x=${Math.round(rb?.x ?? -1)}→${Math.round((rb?.x ?? 0) + (rb?.width ?? 0))} / ${vue.width} ; hors écran : ${r.horsX.slice(0, 6).join(' | ') || 'rien'}`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);

      // Les onglets.
      for (const onglet of ['Réglages', 'Historique', 'Journaux']) {
        await page.getByRole('tab', { name: onglet }).or(page.getByRole('button', { name: new RegExp(`^${onglet}$`) })).first().click();
        await page.waitForTimeout(1500);
        await capture(page, `p10-${cfg.nom}-5-${onglet}`);
        r = await mesurer('body');
        noter(`onglet-${onglet}`, !r.defX && r.horsX.length === 0, `défilement horizontal : ${r.defX ? 'OUI' : 'non'} ; hors écran : ${r.horsX.slice(0, 6).join(' | ') || 'rien'}`);
      }
      const pb = [...m.console, ...m.exceptions, ...m.reseau, ...m.echecs];
      noter('console-reseau', pb.length === 0, pb.length ? JSON.stringify(pb).slice(0, 400) : 'aucune erreur');
    } catch (e) {
      noter('erreur', false, String(e).split('\n')[0].slice(0, 260));
      await capture(page, `p10-${cfg.nom}-echec`);
    } finally { await o.fermer(); }
  }
} finally {
  const { error: e2 } = await admin.from('automation_rules').delete().eq('id', regle.id).eq('org_id', ORG);
  console.log(e2 ? `MÉNAGE EN ÉCHEC : ${e2.message} (id ${regle.id})` : 'ménage : brouillon de test retiré');
  writeFileSync('D:/lume-uiaudit/sorties/editeur-tablette.json', JSON.stringify(bilan, null, 2));
  console.log(`BILAN : ${bilan.filter((x) => x.ok).length}/${bilan.length}`);
}
