/**
 * Agenda + trajets — parcours utilisateur (audit 2026-09-30).
 * Jeu de données : scripts/qa/agenda/fixture.ts (5 équipes × 8 visites × 5 jours + pièges).
 */
import { test, expect, type Page } from '@playwright/test';
import { seConnecter } from './session';
import { simulerCartes, type CompteurCartes } from './cartes-simulees';
import { base, clientConnecte, equipeParNom, heureFr, orgTest, visite } from './outils';

const SEMAINE = '2026-10-05';

async function ouvrirAgenda(page: Page, date = SEMAINE, opts: { erreurCartes?: boolean; email?: string } = {}): Promise<CompteurCartes> {
  const n = await simulerCartes(page, { erreur: opts.erreurCartes });
  await seConnecter(page, opts.email);
  await page.goto(`/calendar?view=agenda&date=${date}`);
  return n;
}

const panneau = (page: Page, jour: string) => page.getByTestId(`trajets-${jour}`);

// Sur téléphone, l'application web montre la « porte mobile » (le bureau se fait
// sur ordinateur, le terrain dans l'app à venir) : le Calendrier n'y existe pas.
test.beforeEach(async ({}, info) => {
  if (info.project.name === 'mobile' && !info.title.includes('porte mobile')) test.skip(true, 'téléphone : porte mobile, voir le test dédié');
});

test('téléphone : la porte mobile s’affiche, aucune donnée d’horaire', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile');
  await ouvrirAgenda(page);
  await expect(page.getByText('Le bureau sur l’ordi.').or(page.getByText("Le bureau sur l'ordi."))).toBeVisible();
  await expect(page.locator('[data-testid^="trajets-"]')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('Lavage —');
});

test.describe('navigation', () => {
  test('semaine par semaine, puis jour par jour', async ({ page }) => {
    await ouvrirAgenda(page);
    await expect(panneau(page, '2026-10-05')).toBeVisible();
    await page.getByRole('button', { name: 'Période suivante' }).click();
    await expect(page).toHaveURL(/date=2026-10-12/);
    await page.getByRole('button', { name: 'Période précédente' }).click();
    await expect(page).toHaveURL(/date=2026-10-05/);
    await page.goto('/calendar?view=day&date=2026-10-05');
    await page.getByRole('button', { name: 'Période suivante' }).click();
    await expect(page).toHaveURL(/date=2026-10-06/);
    await expect(page.locator('[data-visite]').first()).toBeVisible();
  });
});

test.describe('heures', () => {
  test('une visite à 8 h s’affiche à 8 h, même si l’ordinateur est à Vancouver', async ({ browser }, info) => {
    test.skip(info.project.name !== 'bureau');
    const v = await visite('e1-2026-10-05-0'); // Sherbrooke, 8 h 00
    for (const tz of ['America/Toronto', 'America/Vancouver']) {
      const ctx = await browser.newContext({ timezoneId: tz, locale: 'fr-CA', viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      await ouvrirAgenda(page);
      await expect(page.getByTestId(`arret-${v.id}`).getByTestId('heure-arret')).toHaveText('8 h 00');
      await page.goto('/calendar?view=week&date=2026-10-05');
      await expect(page.locator('main')).toContainText('08:00');
      await ctx.close();
    }
  });

  test('après le recul d’heure (2 novembre), 8 h reste 8 h', async ({ page }) => {
    await ouvrirAgenda(page, '2026-11-02');
    await expect(panneau(page, '2026-11-02').getByTestId('heure-arret').first()).toHaveText('8 h 00');
  });
});

test.describe('trajets', () => {
  test('l’ordre des arrêts est l’ordre chronologique, pour chaque équipe', async ({ page }) => {
    await ouvrirAgenda(page);
    const p = panneau(page, '2026-10-05');
    await expect(p).toBeVisible();
    for (const section of await p.locator('[data-testid^="equipe-"]').all()) {
      const ordres = await section.locator('li[data-ordre]').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-ordre'))));
      expect(ordres).toEqual(ordres.map((_, i) => i + 1));
      const heures = await section.getByTestId('heure-arret').allInnerTexts();
      const minutes = heures.map((h) => { const [a, b] = h.replace(/\s/g, '').split('h').map(Number); return a * 60 + b; });
      expect(minutes).toEqual([...minutes].sort((a, b) => a - b));
    }
  });

  test('un marqueur par visite planifiée, chacun relié à SA visite', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'la carte est sous la liste sur téléphone ; même logique');
    await ouvrirAgenda(page);
    const p = panneau(page, '2026-10-05');
    await p.scrollIntoViewIfNeeded();
    await expect(p.locator('.lume-epingle-agenda').first()).toBeVisible();
    const epingles = await p.locator('.lume-epingle-agenda').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.visite));
    const arrets = await p.locator('li[data-testid^="arret-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.slice(6)));
    expect(epingles.sort()).toEqual(arrets.sort());
    // Même nombre que les visites planifiées ce jour-là (sans annulées ni adresses introuvables).
    const org = await orgTest();
    const { data: vs } = await base().from('schedule_events').select('id, status, job_id').eq('org_id', org)
      .gte('start_at', '2026-10-05T04:00:00Z').lt('start_at', '2026-10-06T04:00:00Z').is('deleted_at', null);
    const { data: js } = await base().from('jobs').select('id, latitude').in('id', (vs || []).map((v: any) => v.job_id));
    const geocodees = new Set((js || []).filter((j: any) => j.latitude != null).map((j: any) => j.id));
    const attendu = (vs || []).filter((v: any) => v.status !== 'cancelled' && geocodees.has(v.job_id)).length;
    expect(attendu).toBeGreaterThan(0);
    expect(epingles.length).toBe(attendu);
  });

  test('cliquer un marqueur ouvre la bonne job', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile');
    const v = await visite('e2-2026-10-05-3');
    await ouvrirAgenda(page);
    const p = panneau(page, '2026-10-05');
    await p.scrollIntoViewIfNeeded();
    // Sur un petit écran, deux épingles voisines peuvent se couvrir : choisir
    // l'arrêt dans la liste met son épingle au premier plan, puis on la clique.
    await p.getByTestId(`arret-${v.id}`).locator('[role="button"]').first().click();
    await p.locator(`.lume-epingle-agenda[data-visite="${v.id}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/jobs/${v.job_id}`));
  });

  test('visite annulée hors trajet ; adresse introuvable listée à corriger', async ({ page }) => {
    const annulee = await visite('e3-2026-10-06-3');
    const invalide = await visite('e1-2026-10-07-4');
    await ouvrirAgenda(page);
    await expect(page.getByTestId(`arret-${annulee.id}`)).toHaveCount(0);
    const aCorriger = panneau(page, '2026-10-07').getByTestId('adresses-a-corriger');
    await expect(aCorriger).toContainText('e1-2026-10-07-4');
    await expect(page.getByTestId(`arret-${invalide.id}`)).toHaveCount(0);
  });

  test('alertes : trajet impossible et chevauchement', async ({ page }) => {
    const impossible = await visite('e4-2026-10-05-2'); // Sherbrooke → Trois-Rivières en 15 min
    const chevauche = await visite('e0-2026-10-06-3');
    await ouvrirAgenda(page);
    await expect(page.getByTestId(`arret-${impossible.id}`)).toContainText('Trajet impossible');
    await expect(page.getByTestId(`arret-${chevauche.id}`)).toContainText('Chevauchement');
  });

  test('deux jobs à la même adresse restent visibles', async ({ page }) => {
    const a = await visite('e2-2026-10-08-5');
    const b = await visite('e2-2026-10-08-6');
    await ouvrirAgenda(page);
    await expect(page.getByTestId(`arret-${a.id}`)).toBeVisible();
    await expect(page.getByTestId(`arret-${b.id}`)).toBeVisible();
  });

  test('job multi-jours : une visite chaque jour ; job complétée affichée faite', async ({ page }) => {
    const lundi = await visite('e3-2026-10-05-7');
    const faite = await visite('e0-2026-10-05-0');
    await ouvrirAgenda(page);
    const { data } = await base().from('schedule_events').select('id, start_at').eq('job_id', lundi.job_id).is('deleted_at', null);
    expect((data || []).length).toBe(2);
    for (const v of data || []) await expect(page.getByTestId(`arret-${(v as any).id}`)).toHaveCount(1);
    await expect(page.getByTestId(`arret-${faite.id}`).locator('.line-through')).toHaveCount(1);
  });

  test('filtrer par technicien : une seule équipe', async ({ page }) => {
    const sherbrooke = await equipeParNom('Équipe Sherbrooke');
    await ouvrirAgenda(page);
    await page.goto(`/calendar?view=agenda&date=${SEMAINE}&teams=${sherbrooke}`);
    const p = panneau(page, '2026-10-05');
    await expect(p.getByTestId(`equipe-${sherbrooke}`)).toBeVisible();
    await expect(p.locator('[data-testid^="equipe-"]')).toHaveCount(1);
  });
});

test.describe('mises à jour', () => {
  test('glisser-déposer : l’heure et le trajet suivent tout de suite', async ({ page }, info) => {
    test.skip(info.project.name !== 'bureau', 'glisser-déposer testé sur bureau');
    const v = await visite('e0-2026-10-09-0'); // 8 h 00 → après la dernière (15 h 00)
    await seConnecter(page); await simulerCartes(page);
    await page.goto('/calendar?view=day&date=2026-10-09');
    const carte = page.locator(`[data-visite="${v.id}"]`);
    await expect(carte).toBeVisible();
    const box = (await carte.boundingBox())!;
    const pxParHeure = box.width / 0.75; // 45 min
    await page.mouse.move(box.x + 8, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 8 + pxParHeure * 9, box.y + box.height / 2, { steps: 25 });
    await page.mouse.up();
    // Nouvelle heure enregistrée, après la dernière visite du jour (15 h 45).
    await expect.poll(async () => new Date((await visite('e0-2026-10-09-0')).start_at).getTime(), { timeout: 10_000 })
      .toBeGreaterThan(new Date('2026-10-09T19:45:00Z').getTime());
    const apres = await visite('e0-2026-10-09-0');
    await page.goto(`/calendar?view=agenda&date=${SEMAINE}`);
    const section = panneau(page, '2026-10-09').getByTestId(`equipe-${v.team_id}`);
    // L'ordre du trajet et l'heure affichée suivent : dernière, à l'heure enregistrée.
    await expect(section.getByTestId(`arret-${v.id}`)).toHaveAttribute('data-ordre', '8');
    await expect(section.getByTestId(`arret-${v.id}`).getByTestId('heure-arret')).toHaveText(heureFr(apres.start_at));
  });

  test('temps réel : un autre utilisateur voit le déplacement sans recharger', async ({ page }, info) => {
    test.skip(info.project.name !== 'bureau');
    const v = await visite('e1-2026-10-09-3');
    await ouvrirAgenda(page);
    await expect(page.getByTestId(`arret-${v.id}`)).toBeVisible();
    const autre = await clientConnecte('proprio@agenda.test');
    const debut = new Date(new Date(v.start_at).getTime() + 5 * 3600_000);
    const { error } = await autre.rpc('rpc_reschedule_event', { p_event_id: v.id, p_start_at: debut.toISOString(), p_end_at: new Date(debut.getTime() + 45 * 60_000).toISOString(), p_team_id: null, p_timezone: 'America/Toronto' });
    expect(error).toBeNull();
    await expect(page.getByTestId(`arret-${v.id}`).getByTestId('heure-arret')).toHaveText(heureFr(debut.toISOString()), { timeout: 15_000 });
  });
});

test.describe('sécurité', () => {
  test('rien d’une autre entreprise, ni à l’écran ni dans l’API', async ({ page }) => {
    await ouvrirAgenda(page);
    await expect(panneau(page, '2026-10-05')).toBeVisible();
    await expect(page.locator('body')).not.toContainText('JOB ÉTRANGÈRE');
    const c = await clientConnecte('autre@agenda.test');
    const { data: s } = await c.auth.getSession();
    const r = await page.request.get('/api/agenda/trajets?debut=2026-10-05T04:00:00.000Z&fin=2026-10-12T04:00:00.000Z', { headers: { Authorization: `Bearer ${s.session!.access_token}` } });
    const j = await r.json();
    const titres = j.jours.flatMap((d: any) => d.equipes.flatMap((e: any) => e.arrets.map((a: any) => a.titre)));
    expect(titres.every((t: string) => t === 'JOB ÉTRANGÈRE')).toBe(true);
  });

  test('un technicien restreint à son équipe ne voit que son équipe', async ({ page }) => {
    const volante = await equipeParNom('Équipe Volante');
    await ouvrirAgenda(page, SEMAINE, { email: 'tech5@agenda.test' });
    const p = panneau(page, '2026-10-05');
    await expect(p).toBeVisible();
    const sections = await p.locator('[data-testid^="equipe-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    expect(sections).toEqual([`equipe-${volante}`]);
  });

  test('sans session : l’API refuse', async ({ request }) => {
    const r = await request.get('/api/agenda/trajets?debut=2026-10-05T04:00:00.000Z&fin=2026-10-12T04:00:00.000Z');
    expect(r.status()).toBe(401);
  });
});

test.describe('états', () => {
  test('chargement puis contenu', async ({ page }) => {
    await page.route('**/api/agenda/trajets**', async (r) => { await new Promise((x) => setTimeout(x, 1500)); await r.continue(); });
    await ouvrirAgenda(page);
    await expect(page.getByText('Calcul des trajets…').first()).toBeVisible();
    await expect(panneau(page, '2026-10-05')).toBeVisible();
  });

  test('semaine vide', async ({ page }) => {
    await ouvrirAgenda(page, '2026-12-07');
    await expect(page.getByText('Aucun événement planifié cette période')).toBeVisible();
  });

  test('erreur du calcul des trajets : message et « Réessayer »', async ({ page }) => {
    let panne = true;
    await page.route('**/api/agenda/trajets**', (r) => (panne ? r.fulfill({ status: 500, json: { error: 'x' } }) : r.continue()));
    await ouvrirAgenda(page);
    await expect(page.getByRole('alert').first()).toContainText('Impossible de calculer les trajets');
    panne = false;
    await page.getByRole('button', { name: 'Réessayer' }).first().click();
    await expect(panneau(page, '2026-10-05')).toBeVisible();
  });

  test('API de cartes en panne : la liste reste exacte', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile');
    await ouvrirAgenda(page, SEMAINE, { erreurCartes: true });
    const p = panneau(page, '2026-10-05');
    await expect(p.getByText('Carte indisponible')).toBeVisible();
    await expect(p.locator('li[data-testid^="arret-"]').first()).toBeVisible();
  });
});

test.describe('boutons', () => {
  test('chaque bouton de l’Agenda fait quelque chose (aucun bouton mort)', async ({ page }, info) => {
    test.skip(info.project.name !== 'bureau');
    test.setTimeout(15 * 60_000);
    await ouvrirAgenda(page);
    await expect(panneau(page, '2026-10-05')).toBeVisible();
    const noms = await page.locator('main button:visible').evaluateAll((els) =>
      els.map((e, i) => ({ i, nom: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 60) })).filter((b) => b.nom));
    const morts: string[] = [];
    const vus = new Set<string>();
    // « Optimiser la journée » ouvre Lumi et lance un calcul : couvert par ses propres tests (plus bas).
    for (const { nom } of noms.slice(0, 60)) {
      if (vus.has(nom) || /Optimiser la journée/.test(nom)) continue;
      vus.add(nom);
      await page.goto(`/calendar?view=agenda&date=${SEMAINE}`);
      await expect(panneau(page, '2026-10-05')).toBeVisible();
      const bouton = page.locator('main button:visible').filter({ hasText: nom }).first();
      const cible = (await bouton.count()) ? bouton : page.getByRole('button', { name: nom }).first();
      if (!(await cible.count())) continue;
      const taille = () => page.evaluate(() => document.body.innerHTML.length).catch(() => -1); // -1 : la page a navigué
      const avant = { url: page.url(), dom: await taille() };
      await cible.click({ timeout: 5000 }).catch(() => undefined);
      await page.waitForTimeout(600);
      await page.waitForLoadState('domcontentloaded').catch(() => undefined);
      const apres = { url: page.url(), dom: await taille() };
      if (apres.url === avant.url && apres.dom === avant.dom && apres.dom !== -1) morts.push(nom);
    }
    expect(morts).toEqual([]);
  });
});

test.describe('coûts', () => {
  test('charger la semaine : zéro appel Mapbox de routage, zéro appel de routes au rechargement', async ({ page }) => {
    const n = await ouvrirAgenda(page);
    await expect(panneau(page, '2026-10-09')).toBeVisible();
    await page.reload();
    await expect(panneau(page, '2026-10-09')).toBeVisible();
    const avant = (await (await fetch('http://127.0.0.1:5899/_compteurs')).json()).appels as number;
    await page.reload();
    await expect(panneau(page, '2026-10-09')).toBeVisible();
    const apres = (await (await fetch('http://127.0.0.1:5899/_compteurs')).json()).appels as number;
    expect(n.directions + n.optimisation).toBe(0);
    expect(apres - avant).toBe(0);
  });
});

test.describe('performance et rendu', () => {
  test('la semaine complète s’affiche vite', async ({ page }) => {
    await simulerCartes(page); await seConnecter(page);
    const t0 = Date.now();
    await page.goto(`/calendar?view=agenda&date=${SEMAINE}`);
    await expect(panneau(page, '2026-10-09')).toBeVisible();
    expect(Date.now() - t0).toBeLessThan(8000);
  });

  test('régression visuelle du trajet du jour', async ({ page }) => {
    await ouvrirAgenda(page);
    const p = panneau(page, '2026-10-05');
    await expect(p).toBeVisible();
    await expect(p).toHaveScreenshot('trajet-du-jour.png', { mask: [p.getByTestId('carte-jour')] });
  });
});

test.describe('Optimiser la journée (Lumi)', () => {
  async function heuresDuJour(date: string): Promise<Map<string, string>> {
    const org = await orgTest();
    const { data } = await base().from('schedule_events').select('id, start_at').eq('org_id', org)
      .gte('start_at', `${date}T04:00:00Z`).lt('start_at', `${date}T23:59:00Z`).is('deleted_at', null);
    return new Map((data || []).map((v: any) => [v.id, new Date(v.start_at).toISOString()]));
  }

  test('bouton → Lumi → carte de proposition → accepter → l’agenda reflète exactement la proposition', async ({ page }, info) => {
    test.skip(info.project.name !== 'bureau');
    const date = '2026-10-08';
    const avant = await heuresDuJour(date);
    await simulerCartes(page); await seConnecter(page);
    await page.goto(`/calendar?view=day&date=${date}`);
    await page.getByRole('button', { name: 'Optimiser la journée' }).click();
    await page.getByTestId(`jour-${date}`).click();
    await expect(page).toHaveURL(/\/lumi/);
    const apercu = page.getByTestId('apercu-optimisation');
    await expect(apercu).toBeVisible({ timeout: 30_000 });
    await expect(apercu).toContainText('L’optimisation n’envoie aucun message aux clients.');
    const nLignes = await apercu.getByTestId('ligne-optimisation').count();
    expect(nLignes).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Confirmer' }).click();
    await expect.poll(async () => [...(await heuresDuJour(date)).entries()].filter(([id, t]) => avant.get(id) !== t).length, { timeout: 20_000 }).toBe(nLignes);
    // L'agenda affiche les nouvelles heures (même source que la base) et l'ordre chronologique.
    const apres = await heuresDuJour(date);
    const [idBouge, t] = [...apres.entries()].find(([id, x]) => avant.get(id) !== x)!;
    await page.goto(`/calendar?view=agenda&date=${SEMAINE}`);
    await expect(page.getByTestId(`arret-${idBouge}`).getByTestId('heure-arret')).toHaveText(heureFr(t));
  });

  test('bouton → Lumi → refuser → rien ne change', async ({ page }, info) => {
    test.skip(info.project.name !== 'bureau');
    const date = '2026-10-06';
    const avant = JSON.stringify([...(await heuresDuJour(date)).entries()].sort());
    await simulerCartes(page); await seConnecter(page);
    await page.goto(`/calendar?view=day&date=${date}`);
    await page.getByRole('button', { name: 'Optimiser la journée' }).click();
    await page.getByTestId(`jour-${date}`).click();
    await expect(page.getByTestId('apercu-optimisation')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Refuser' }).click();
    await page.waitForTimeout(1500);
    expect(JSON.stringify([...(await heuresDuJour(date)).entries()].sort())).toBe(avant);
  });

  test('un technicien sans droit de replanifier voit la proposition, sans carte', async ({ page }, info) => {
    test.skip(info.project.name !== 'bureau');
    const org = await orgTest();
    const { data: u } = await base().from('memberships').select('user_id').eq('org_id', org).eq('full_name', 'Tech 1').single();
    await base().from('memberships').update({ permissions: { 'calendar.update': false, 'jobs.update': false } }).eq('org_id', org).eq('user_id', (u as any).user_id);
    try {
      await simulerCartes(page); await seConnecter(page, 'tech1@agenda.test');
      await page.goto('/lumi?action=optimiser-journee&date=2026-10-09');
      await expect(page.getByText('pas de replanifier le calendrier')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('apercu-optimisation')).toHaveCount(0);
    } finally {
      await base().from('memberships').update({ permissions: null }).eq('org_id', org).eq('user_id', (u as any).user_id);
    }
  });
});
