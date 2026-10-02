/**
 * Le forfait (`includes_automations`) — carte §1.2 et soupçon S-03.
 *
 * Question : un bureau dont le forfait n'inclut PAS les automatisations est-il
 * arrêté par l'interface seulement, ou aussi par le serveur et par la base ?
 *
 * Mise en situation, dans le bureau de test B UNIQUEMENT : la ligne d'abonnement
 * factice du bureau (créée par le banc, 0 $, sans Stripe) pointe le temps du test
 * vers le forfait « starter » (`includes_automations = false`), puis est REMISE sur
 * son forfait d'origine dans un `finally`. Aucun forfait ni abonnement réel n'est touché.
 *
 * Le serveur garde le verdict de forfait 60 s en mémoire : les attentes côté API
 * scrutent la réponse jusqu'à 75 s au lieu d'attendre un délai fixe.
 */
import type { Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { mkdirSync } from 'node:fs';
import { clientDe } from '../_outils/banc';
import { test, expect, api, SORTIES_LOT } from './_roles';

const CAP = `${SORTIES_LOT}/captures`;
mkdirSync(CAP, { recursive: true });

/** Passe le bureau sur le forfait `slug` le temps de `corps`, puis remet le forfait d'origine. */
async function avecForfait(admin: SupabaseClient, org: string, slug: string, corps: () => Promise<void>): Promise<void> {
  const { data: nom } = await admin.from('orgs').select('name').eq('id', org).maybeSingle();
  if (!/^\[TEST\] QA Automatisations/.test(String(nom?.name ?? ''))) throw new Error('REFUS : le forfait ne se change que dans un bureau de test.');
  const { data: plan } = await admin.from('plans').select('id, includes_automations').eq('slug', slug).maybeSingle();
  if (!plan) throw new Error(`forfait ${slug} introuvable`);
  const { data: sub } = await admin.from('subscriptions').select('id, plan_id').eq('org_id', org).in('status', ['active', 'trialing']).maybeSingle();
  if (!sub) throw new Error('abonnement de test introuvable');
  const { error } = await admin.from('subscriptions').update({ plan_id: plan.id }).eq('id', sub.id);
  if (error) throw new Error(`changement de forfait : ${error.message}`);
  try { await corps(); } finally {
    const { error: e2 } = await admin.from('subscriptions').update({ plan_id: sub.plan_id }).eq('id', sub.id);
    if (e2) throw new Error(`ATTENTION : le forfait du bureau de test B n’a pas été remis (${e2.message}) — plan_id d’origine ${sub.plan_id}`);
  }
}

/** La fenêtre d'offre de forfait (PlanUpgradeModal) : le voile qui porte le titre « Automatisations ». */
function fenetreOffre(page: Page) {
  return page.locator('[role="presentation"], [role="dialog"]').filter({ has: page.getByRole('heading', { name: 'Automatisations', level: 2 }) }).first();
}

test.describe('forfait sans automatisations (bureau de test B sur « starter »)', () => {
  test('[RTE-09] interface : le menu « Automatisations » disparaît et la page annonce « Fonctionnalité premium » avec l’offre de forfait', async ({ ongletDe, bureau }) => {
    test.setTimeout(240_000);
    await avecForfait(bureau.admin, bureau.orgB, 'starter', async () => {
      const { page } = await ongletDe('proprioB');
      await page.goto('/automations');
      // La garde de forfait est à l'intérieur de la garde de permission : le propriétaire voit l'offre, pas « Accès restreint ».
      // « Fonctionnalité premium » est écrit DEUX fois (la garde, src/components/PlanFeatureGate.tsx, et la fenêtre
      // d'offre qui s'ouvre d'elle-même, PlanUpgradeModal.tsx) : la garde se reconnaît à sa phrase, unique.
      const phraseGarde = page.getByText('Passez à un forfait supérieur pour accéder à cette section.');
      await expect(phraseGarde).toBeVisible({ timeout: 90_000 });
      await expect(page.getByText('Fonctionnalité premium').first()).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Mes automatisations' })).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Accès restreint' })).toHaveCount(0);
      // La fenêtre d'offre s'ouvre d'elle-même et nomme la fonction.
      const offre = fenetreOffre(page);
      await expect(offre).toBeVisible();
      await expect(offre.getByText('Fonctionnalité premium')).toBeVisible();
      await expect(offre.getByText(/Inclus dans le plan/)).toBeVisible();
      await page.screenshot({ path: `${CAP}/RTE-09-forfait-premium.png` });
      await offre.getByRole('button', { name: 'Fermer' }).click();
      await expect(offre).toHaveCount(0);
      // L'issue reste offerte après fermeture.
      await expect(page.getByRole('button', { name: 'Voir les détails' })).toBeVisible();
      // Le menu ne propose plus l'entrée (le groupe « Plus » est ouvert s'il existe).
      const plus = page.getByRole('complementary').getByRole('button', { name: 'Plus', exact: true });
      if (await plus.isVisible()) await plus.click();
      await expect(page.getByRole('complementary').getByRole('button', { name: 'Automatisations', exact: true })).toHaveCount(0);
      // Les sous-routes sont gardées de la même façon.
      for (const route of ['/automations/apercu', '/automations/reglages', '/automations/nouvelle']) {
        await page.goto(route);
        await expect(page.getByText('Passez à un forfait supérieur pour accéder à cette section.'), route).toBeVisible({ timeout: 60_000 });
        await expect(page.getByRole('tab', { name: 'Parcours' }), `${route} : l’éditeur ne s’ouvre pas`).toHaveCount(0);
      }
    });
    // Remis en état : le bureau B a de nouveau le forfait d'origine.
    const { data } = await bureau.admin.from('subscriptions').select('plans:plan_id(slug)').eq('org_id', bureau.orgB).in('status', ['active', 'trialing']).maybeSingle();
    expect((data as { plans?: { slug?: string } } | null)?.plans?.slug).toBe('autopilot');
  });

  /* Scindé de [RTE-09] le 2026-10-01 (première exécution, pile locale) : le test d'origine attendait
     `getByRole('dialog')` et la fermeture par Échap. La fenêtre d'offre (PlanUpgradeModal.tsx) est un
     `role="presentation"` sans `role="dialog"` ni `aria-modal`, et n'écoute pas le clavier : mêmes attentes,
     dans un test à part pour que le reste de RTE-09 (garde, menu, sous-routes) soit jugé pour lui-même. */
  test('[RTE-09] la fenêtre d’offre de forfait est annoncée comme une fenêtre de dialogue et se ferme avec Échap @defaut', async ({ ongletDe, bureau }) => {
    test.setTimeout(240_000);
    await avecForfait(bureau.admin, bureau.orgB, 'starter', async () => {
      const { page } = await ongletDe('proprioB');
      await page.goto('/automations');
      await expect(page.getByText('Passez à un forfait supérieur pour accéder à cette section.')).toBeVisible({ timeout: 90_000 });
      const offre = fenetreOffre(page);
      await expect(offre).toBeVisible();
      // Attendu : un lecteur d'écran sait qu'une fenêtre s'est ouverte par-dessus la page, et laquelle.
      const modale = page.getByRole('dialog');
      await expect.soft(modale, 'la fenêtre d’offre n’a pas le rôle « dialog » : rien n’annonce qu’elle recouvre la page').toHaveCount(1);
      if (await modale.count()) await expect.soft(modale).toContainText('Automatisations');
      // Attendu : Échap la ferme, comme toute fenêtre de l'app.
      await page.keyboard.press('Escape');
      await expect.soft(offre, 'Échap ne ferme pas la fenêtre d’offre').toHaveCount(0, { timeout: 5_000 });
    });
  });

  test('[S-03] serveur : sur un forfait sans automatisations, l’API répond 403 « feature_not_in_plan » et n’écrit rien @defaut', async ({ jeton, outils, bureau, baseURL }) => {
    test.setTimeout(300_000);
    const base = baseURL!; // fixé par la config Playwright
    await avecForfait(bureau.admin, bureau.orgB, 'starter', async () => {
      const j = await jeton('proprioB');
      // Le verdict de forfait est gardé 60 s par le serveur : on scrute jusqu'à 75 s.
      const fin = Date.now() + 75_000;
      let code = 0;
      for (;;) {
        code = (await api(base, j, bureau.orgB, 'GET', '/api/automations/rules')).status;
        if (code === 403 || Date.now() > fin) break;
        await new Promise((r) => setTimeout(r, 3_000));
      }
      expect.soft(code, 'GET /api/automations/rules hors forfait : 403 « feature_not_in_plan » attendu (le mode par défaut du serveur, FEATURE_GUARD=log, laisse passer et journalise)').toBe(403);
      const nom = `${outils.marque} créée hors forfait`;
      const r = await api(base, j, bureau.orgB, 'POST', '/api/automations/rules', { name: nom, trigger_event: 'lead.created', delay_seconds: 0, actions: [{ type: 'log_activity', config: {} }] });
      const { count } = await bureau.admin.from('automation_rules').select('id', { count: 'exact', head: true }).eq('org_id', bureau.orgB).eq('name', nom);
      expect.soft(r.status, `POST /api/automations/rules hors forfait → ${r.status} ${r.texte.slice(0, 120)}`).toBe(403);
      expect.soft(count, 'aucune automatisation n’est créée hors forfait').toBe(0);
    });
  });

  test('[S-03] base : sur un forfait sans automatisations, PostgREST ne laisse ni créer ni publier une automatisation @defaut', async ({ jeton, outils, bureau }) => {
    test.setTimeout(120_000);
    await avecForfait(bureau.admin, bureau.orgB, 'starter', async () => {
      const sb = clientDe(await jeton('proprioB'));
      const nom = `${outils.marque} publiée hors forfait`;
      const publiee = await sb.from('automation_rules').insert({ org_id: bureau.orgB, name: nom, trigger_event: 'lead.created', conditions: {}, delay_seconds: 0, actions: [{ type: 'create_task', config: { title: 'Rappeler' } }], is_active: true });
      const { data } = await bureau.admin.from('automation_rules').select('is_active').eq('org_id', bureau.orgB).eq('name', nom);
      expect.soft((data ?? []).length, 'une règle PUBLIÉE est née par PostgREST dans un bureau dont le forfait n’inclut pas les automatisations (ni la RLS ni le moteur ne regardent le forfait)').toBe(0);
      /* Depuis #889 ce premier refus vient de la garde `trg_automation_rules_garde` (« Une automatisation naît en
         brouillon »), qui vaut pour TOUS les forfaits : il ne prouve pas que la base regarde le forfait. Le titre dit
         « ni créer ni publier » : la création d'un BROUILLON hors forfait est donc tentée aussi. */
      expect.soft(publiee.error?.code ?? '', `refus de l’insertion publiée : ${publiee.error?.message ?? 'aucune erreur'}`).toBe('42501');
      const nomBrouillon = `${outils.marque} brouillon hors forfait`;
      const brouillon = await sb.from('automation_rules').insert({ org_id: bureau.orgB, name: nomBrouillon, trigger_event: 'lead.created', conditions: {}, delay_seconds: 0, actions: [{ type: 'create_task', config: { title: 'Rappeler' } }], is_active: false });
      const { count } = await bureau.admin.from('automation_rules').select('id', { count: 'exact', head: true }).eq('org_id', bureau.orgB).eq('name', nomBrouillon);
      expect.soft(count ?? 0, `un BROUILLON d’automatisation est né par PostgREST dans un bureau dont le forfait n’inclut pas les automatisations (${brouillon.error ? `erreur ${brouillon.error.code}` : 'insertion acceptée'})`).toBe(0);
    });
  });
});
