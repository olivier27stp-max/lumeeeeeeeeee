/**
 * Ce que les rôles déclenchent et ce qui leur est répondu — soupçons S-07, S-08
 * (côté interface), S-15, S-19, S-20 et S-21 de la carte.
 *
 *  · S-07 : les routes d'événements héritées et ce que voit le propriétaire
 *    quand un technicien termine un job (notification en français ?).
 *  · S-08 / S-20 : le membre « read + update » non admin se voit offrir « Tout
 *    arrêter » et la langue des messages, que la base lui refuse.
 *  · S-15 : les appels reçus par une adresse d'appel sont-ils visibles à l'écran ?
 *  · S-21 : le courriel d'une automatisation porte-t-il la marque Lume ?
 *
 * ⚠ ÉCRIT D'APRÈS LE CODE, LA CARTE ET LES RÉPONSES OBSERVÉES PAR LA SONDE DU
 * 2026-10-01 ; LES TESTS D'INTERFACE DE CE FICHIER N'ONT JAMAIS ÉTÉ EXÉCUTÉS
 * (staging en panne) : sélecteurs à confirmer à la première passe.
 */
import { mkdirSync } from 'node:fs';
import { test, expect, api, erreurDe, API_DIRECTE, SORTIES_LOT } from './_roles';

const CAP = `${SORTIES_LOT}/captures`;
mkdirSync(CAP, { recursive: true });
const LONG = { timeout: 90_000 };

test.describe('S-07 — événements signalés par le navigateur', () => {
  test('[S-07][S-19] quand un technicien termine un job, la notification « prêt à facturer » reçue par le propriétaire est en français', async ({ jeton, outils, bureau }) => {
    test.setTimeout(180_000);
    const filtre = () => bureau.admin.from('notifications').select('id, title, body, user_id').eq('org_id', bureau.orgA).eq('type', 'job_ready_for_invoicing').eq('entity_id', outils.decor.job);
    await bureau.admin.from('notifications').delete().eq('org_id', bureau.orgA).eq('type', 'job_ready_for_invoicing').eq('entity_id', outils.decor.job);
    try {
      const r = await api(API_DIRECTE, await jeton('techA'), bureau.orgA, 'POST', '/api/automations/events/job-completed', { jobId: outils.decor.job });
      expect(r.status, r.texte.slice(0, 160)).toBe(200);
      await expect.poll(async () => ((await filtre()).data ?? []).length, { timeout: 30_000 }).toBeGreaterThan(0);
      const lignes = (await filtre()).data ?? [];
      // Une par propriétaire / admin du bureau.
      expect(lignes.map((l) => l.user_id)).toContain(bureau.comptes.proprioA.id);
      // Le bureau écrit en français (company_settings.default_language = fr) et le propriétaire aussi.
      for (const l of lignes) {
        expect.soft(String(l.title), 'titre codé en dur en anglais (server/routes/automation-events.ts:219)').not.toMatch(/Job ready for invoicing/);
        expect.soft(String(l.body), 'corps codé en dur en anglais (automation-events.ts:220)').not.toMatch(/has been completed by a technician/);
      }
    } finally {
      await bureau.admin.from('notifications').delete().eq('org_id', bureau.orgA).eq('type', 'job_ready_for_invoicing').eq('entity_id', outils.decor.job);
    }
  });

  test('[S-07] « visite déplacée » signalée pour une visite qui n’a PAS bougé : aucune nouvelle confirmation ne repart vers le client (comme les routes étiquette et tâche, qui vérifient l’état annoncé)', async ({ jeton, outils, bureau }) => {
    test.setTimeout(180_000);
    const compter = async () => (await bureau.admin.from('activity_log').select('id', { count: 'exact', head: true }).eq('org_id', bureau.orgA).eq('event_type', 'appointment_created').eq('entity_id', outils.decor.visite)).count ?? 0;
    /* État de départ CONNU, posé par ce test : la visite vient d'être annoncée une fois, ses rappels sont planifiés pour
       son heure actuelle. Sans cela le résultat dépendait du test passé avant (la matrice API-32 déplace la visite du
       décor : l'annonce suivante est alors légitime, et ce test tombait rouge à tort — pile locale, 2026-10-01). */
    const pose = await api(API_DIRECTE, await jeton('proprioA'), bureau.orgA, 'POST', '/api/automations/events/appointment-rescheduled', { eventId: outils.decor.visite });
    expect(pose.status, pose.texte.slice(0, 160)).toBe(200);
    await expect.poll(async () => (await bureau.admin.from('automation_scheduled_tasks').select('id', { count: 'exact', head: true })
      .eq('org_id', bureau.orgA).eq('entity_id', outils.decor.visite).in('status', ['pending', 'running', 'completed'])).count ?? 0,
    { timeout: 30_000, message: 'les rappels de la visite du décor sont planifiés pour son heure actuelle' }).toBeGreaterThan(0);
    const avant = await compter();
    // Le technicien (calendar.update) annonce un déplacement ; la visite du décor n'a pas changé de date.
    const r = await api(API_DIRECTE, await jeton('techA'), bureau.orgA, 'POST', '/api/automations/events/appointment-rescheduled', { eventId: outils.decor.visite });
    expect(r.status, r.texte.slice(0, 160)).toBe(200);
    // Depuis #870 : la route répond « inchangé » et ne touche à rien (server/routes/automation-events.ts § 0).
    expect.soft((r.json as { inchange?: boolean; cancelled?: number }).inchange, `réponse : ${r.texte.slice(0, 160)}`).toBe(true);
    expect.soft((r.json as { inchange?: boolean; cancelled?: number }).cancelled, 'aucun rappel annulé').toBe(0);
    // Observé le 2026-10-01 : 200 { ok: true, cancelled: n } pour chacun des six rôles, rappels annulés puis replanifiés,
    // et le courriel « Votre rendez-vous est confirmé » retenu deux fois par le bac à sable pour la même visite immobile.
    const fin = Date.now() + (r.status < 300 ? 8_000 : 1_000);
    let apres = await compter();
    while (apres === avant && Date.now() < fin) { await new Promise((ok) => setTimeout(ok, 400)); apres = await compter(); }
    expect.soft(apres - avant, 'aucun « rendez-vous planifié » ne doit être ré-émis quand la date n’a pas changé').toBe(0);
  });

  test('[S-07] routes héritées : un vendeur reçoit 403 sur quote-sent, lead-created, lead-status-changed et deal-stage-changed — et plus aucun écran ne les appelle', async ({ jeton, outils, bureau }) => {
    const j = await jeton('vendeurA');
    const d = outils.decor;
    for (const [nom, corps] of [
      ['quote-sent', { quoteId: d.devis }], ['lead-created', { leadId: d.client }],
      ['lead-status-changed', { leadId: d.client, oldStatus: 'new', newStatus: 'contacted' }], ['deal-stage-changed', { dealId: d.client, leadId: d.client }],
    ] as const) {
      const r = await api(API_DIRECTE, j, bureau.orgA, 'POST', `/api/automations/events/${nom}`, corps);
      expect.soft(r.status, `${nom} → ${r.status} ${erreurDe(r)}`).toBe(403);
    }
    // Les quatre émetteurs du navigateur n'ont plus d'appelant : rien à cliquer pour un vendeur (constat de code mort, voir couverture.md).
  });
});

test.describe('S-08 / S-20 — commandes réservées aux administrateurs, vues par un membre « read + update »', () => {
  test('[S-08] « Tout arrêter » cliqué par un non-admin : la confirmation s’ouvre, puis le refus est dit clairement en français et rien n’est arrêté', async ({ ongletDe, bureau }) => {
    test.setTimeout(240_000);
    await bureau.admin.from('company_settings').update({ automations_paused: false, automations_paused_at: null, automations_paused_by: null }).eq('org_id', bureau.orgA);
    const { page, moniteur } = await ongletDe('editeurA');
    moniteur.attendu(/403 POST .*\/api\/automations\/pause/, 'la base réserve la pause aux propriétaires et admins');
    moniteur.attendu(/\[BandeauPause\]/, 'le composant journalise le refus en console');
    await page.goto('/automations');
    await expect(page.getByRole('heading', { name: 'Mes automatisations', level: 1 })).toBeVisible(LONG);
    await page.getByRole('button', { name: 'Tout arrêter' }).click();
    const dialogue = page.getByRole('dialog');
    await expect(dialogue).toContainText('Arrêter toutes vos automatisations ?');
    await dialogue.getByRole('button', { name: 'Tout arrêter' }).click();
    await expect(page.getByText('Seul un administrateur peut arrêter les automatisations. Rien n’a été arrêté.')).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: `${CAP}/S-08-tout-arreter-refuse.png` });
    // L'écran ne prétend pas que c'est en pause, et la base non plus.
    await expect(page.getByText('Vos automatisations sont en pause.')).toHaveCount(0);
    const { data } = await bureau.admin.from('company_settings').select('automations_paused').eq('org_id', bureau.orgA).maybeSingle();
    expect(data?.automations_paused === true).toBe(false);
  });

  test('[S-08] langue des messages changée par un non-admin : refus clair en français, la langue ne bouge ni à l’écran ni en base', async ({ ongletDe, bureau }) => {
    test.setTimeout(240_000);
    await bureau.admin.from('company_settings').update({ default_language: 'fr' }).eq('org_id', bureau.orgA);
    const { page, moniteur } = await ongletDe('editeurA');
    moniteur.attendu(/langue des messages/, 'le composant journalise le refus en console');
    await page.goto('/automations');
    await expect(page.getByRole('heading', { name: 'Mes automatisations', level: 1 })).toBeVisible(LONG);
    await page.getByRole('button', { name: 'EN', exact: true }).click();
    await expect(page.getByText('Seul un administrateur peut changer la langue des messages. Rien n’a été modifié.')).toBeVisible({ timeout: 30_000 });
    const { data } = await bureau.admin.from('company_settings').select('default_language').eq('org_id', bureau.orgA).maybeSingle();
    expect(data?.default_language).toBe('fr');
  });

  test('[S-08][S-20] « Tout arrêter » et le choix « Messages en FR / EN » ne sont pas offerts (ou sont désactivés) à qui la base les refuse @defaut', async ({ ongletDe }) => {
    const { page } = await ongletDe('editeurA');
    await page.goto('/automations');
    await expect(page.getByRole('heading', { name: 'Mes automatisations', level: 1 })).toBeVisible(LONG);
    await expect(page.getByRole('table')).toBeVisible(LONG);
    const arret = page.getByRole('button', { name: 'Tout arrêter' });
    const en = page.getByRole('button', { name: 'EN', exact: true });
    // Aucun `usePermissions` dans les pages Automatisations : les commandes sont offertes à tous ceux qui passent la garde de page.
    expect.soft((await arret.count()) === 0 || await arret.isDisabled(), '« Tout arrêter » est cliquable par un non-admin, qui sera toujours refusé').toBe(true);
    expect.soft((await en.count()) === 0 || await en.isDisabled(), '« Messages en EN » est cliquable par un non-admin, qui sera toujours refusé').toBe(true);
  });
});

test.describe('S-15 — appels reçus par une adresse d’appel', () => {
  test('[S-15] Réglages globaux › Adresses d’appel : les appels reçus par une adresse sont consultables à l’écran @defaut', async ({ page, outils, bureau, baseURL }) => {
    test.setTimeout(240_000);
    const { data: w, error } = await bureau.admin.from('automation_webhooks').insert({ org_id: bureau.orgA, name: `${outils.marque} formulaire du site`, created_by: bureau.comptes.proprioA.id }).select('id, api_key').single();
    if (error || !w) throw new Error(`adresse d’appel : ${error?.message}`);
    try {
      const r = await api(baseURL!, null, null, 'POST', `/api/hooks/${w.api_key}`, { prenom: 'Témoin', courriel: 'temoin-s15@lume-qa.test' }); // baseURL fixé par la config
      expect(r.status, r.texte.slice(0, 160)).toBe(200);
      await expect.poll(async () => (await bureau.admin.from('automation_webhook_receipts').select('id', { count: 'exact', head: true }).eq('webhook_id', w.id)).count, { timeout: 30_000 }).toBe(1);
      await page.goto('/automations/reglages');
      await expect(page.getByRole('heading', { name: 'Adresses d’appel' })).toBeVisible(LONG);
      await expect(page.getByText(`${outils.marque} formulaire du site`)).toBeVisible(LONG);
      await page.screenshot({ path: `${CAP}/S-15-adresses-appel.png`, fullPage: true });
      // Le reçu existe en base (corps complet) ; l'écran doit permettre de le voir : au moins un compteur ou la date du dernier appel.
      const carte = page.locator('div', { has: page.getByRole('heading', { name: 'Adresses d’appel' }) }).last();
      /* Le motif d'origine acceptait le mot « reçu » seul : il était satisfait par le texte d'AIDE de la carte
         (« … une automatisation qui part de « Appel reçu de l’extérieur » », src/pages/AutomationsReglages.tsx) — vert
         trompeur à la passe locale du 2026-10-01, alors que rien à l'écran ne montre les appels reçus
         (src/components/automations/AdressesDAppel.tsx n'affiche ni compteur ni date). Une vraie trace : un compte
         d'appels, la date du dernier, ou le contenu reçu. */
      await expect(carte.getByText(/\b1 appel\b|dernier appel|appels? reçus? ?[:(]|temoin-s15@lume-qa\.test/i).first(), 'aucune trace à l’écran de l’appel reçu : on ne sait pas si l’intégration fonctionne').toBeVisible({ timeout: 15_000 });
    } finally {
      await bureau.admin.from('automation_webhook_receipts').delete().eq('webhook_id', w.id);
      await bureau.admin.from('automation_webhooks').delete().eq('id', w.id);
    }
  });
});

test.describe('S-21 — courriel d’une automatisation', () => {
  test('[S-21] le courriel « Votre rendez-vous est confirmé » retenu par le bac à sable porte la marque du BUREAU, sans mascotte ni mention Lume', async ({ jeton, outils, bureau }) => {
    test.setTimeout(240_000);
    // Déplacer la visite du décor ré-émet « rendez-vous planifié » : la confirmation (préréglage publié) repart, retenue en bac à sable.
    const r = await api(API_DIRECTE, await jeton('proprioA'), bureau.orgA, 'POST', '/api/automations/events/appointment-rescheduled', { eventId: outils.decor.visite });
    expect(r.status, r.texte.slice(0, 160)).toBe(200);
    const lire = async () => (await bureau.admin.from('envois_simules').select('sujet, corps, created_at').eq('org_id', bureau.orgA).eq('canal', 'courriel').eq('destinataire', 'decor-roles@lume-qa.test').order('created_at', { ascending: false }).limit(1)).data ?? [];
    await expect.poll(async () => (await lire()).length, { timeout: 60_000, message: 'un courriel de confirmation a été retenu pour le client du décor (aujourd’hui ou lors d’une passe précédente)' }).toBeGreaterThan(0);
    const [courriel] = await lire();
    const corps = String(courriel.corps);
    expect(corps, 'le nom du bureau figure dans le courriel').toContain('Nettoyage Test A');
    expect(corps, 'aucune mascotte ni logo Lume dans un courriel client (marque blanche)').not.toMatch(/mascotte|lume-logo|lumecrm\.net\/[^"']*\.(png|svg)/i);
    expect(corps, 'aucune mention « Lume » visible').not.toMatch(/>\s*[^<]*\bLume\b[^<]*</);
  });
});
