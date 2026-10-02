/**
 * Les soupçons de sécurité de la carte (§9), tranchés un par un.
 *
 *  · S-02 : la garde de permission du serveur compare le chemin EXACT. Un chemin
 *    équivalent pour Express (barre finale, autre casse, double barre) la contourne-t-il ?
 *  · S-03 : le forfait (`includes_automations`) est-il appliqué par le serveur et
 *    par la base, ou seulement par l'interface ?
 *  · S-04 : la base laisse-t-elle, à qui a `automations.update`, faire par
 *    PostgREST ce que le serveur interdit (publier un parcours incomplet,
 *    toucher `is_preset` / `preset_key` / `deleted_at` / `purged_at`, supprimer pour de bon) ?
 *  · S-05 : la corbeille est-elle respectée par toutes les routes ?
 *  · S-06 : que renvoie `/api/automations/test` ?
 *  · S-08 : « Tout arrêter », la langue des messages, et la langue des refus.
 *  · S-17, S-18 : clé d'une adresse d'appel ; événement sur le deal d'un autre bureau.
 *
 * Chaque test affirme le comportement ATTENDU ; quand le produit s'en écarte le
 * test reste rouge (titre terminé par @defaut) et le constat est consigné.
 *
 * Les appels partent vers l'API Express elle-même (`API_DIRECTE`), sans le
 * mandataire de Vite : c'est ce que la production expose.
 */
import { clientDe } from '../_outils/banc';
import { test, expect, api, erreurDe, API_DIRECTE, type Reponse } from './_roles';
import { regleA, type Outils } from './_routes';

/** Nombre de lignes du journal d'activité du bureau A pour ce type d'événement, écrites par cet acteur. */
async function activite(o: Outils, type: string, acteur: string): Promise<number> {
  const { count, error } = await o.admin.from('activity_log').select('id', { count: 'exact', head: true }).eq('org_id', o.orgA).eq('event_type', type).eq('actor_id', acteur);
  if (error) throw new Error(`activity_log : ${error.message}`);
  return count ?? 0;
}
/** Attend (au plus `ms`) que la valeur lue dépasse `avant` ; rend la dernière valeur. */
async function apresPatience(lire: () => Promise<number>, avant: number, ms: number): Promise<number> {
  const fin = Date.now() + ms;
  for (;;) {
    const v = await lire();
    if (v > avant || Date.now() > fin) return v;
    await new Promise((r) => setTimeout(r, 400));
  }
}
const bref = (r: Reponse) => `${r.status} ${r.texte.slice(0, 160).replace(/\s+/g, ' ')}`;

// ════════════════════════════════════════════════════════════════════════════
// S-02 — la garde de permission et les chemins équivalents
// ════════════════════════════════════════════════════════════════════════════

test.describe('S-02 — chemins équivalents pour Express, jeton du technicien', () => {
  test('[S-02] événements : une barre finale, une autre casse ou une double barre ne laissent PAS un technicien déclencher les automatisations', async ({ jeton, outils, bureau }) => {
    test.setTimeout(300_000);
    const tech = await jeton('techA');
    const idTech = bureau.comptes.techA.id;
    // Une automatisation publiée du bureau, à effet immédiat : si l'événement passe, elle tourne.
    const temoin = await regleA(outils, 'témoin nouveau prospect', { trigger_event: 'lead.created', is_active: true, actions: [{ type: 'create_task', config: { title: `${outils.marque} tâche née d’un événement interdit` } }] });
    const d = outils.decor;
    const essais: Array<{ chemin: string; corps: unknown; type: string }> = [
      { chemin: '/api/automations/events/lead-created/', corps: { leadId: d.client }, type: 'lead_created' },
      { chemin: '/api/automations/events/LEAD-CREATED', corps: { leadId: d.client }, type: 'lead_created' },
      { chemin: '/api//automations/events/lead-created', corps: { leadId: d.client }, type: 'lead_created' },
      { chemin: '/API/automations/events/lead-created', corps: { leadId: d.client }, type: 'lead_created' },
      { chemin: '/api/automations/events/lead-status-changed/', corps: { leadId: d.client, oldStatus: 'new', newStatus: 'contacted' }, type: 'status_changed' },
      { chemin: '/api/automations/events/quote-sent/', corps: { quoteId: d.devis }, type: 'quote_sent' },
      { chemin: '/api/automations/events/deal-stage-changed/', corps: { dealId: d.client, leadId: d.client }, type: 'deal_stage_changed' },
      // Le technicien n'a ni `clients.update` ni `leads.update` : même la route « étiquette » lui est fermée.
      { chemin: '/api/automations/events/client-tagged/', corps: { clientId: d.client, tag: d.etiquette }, type: 'client_tagged' },
    ];
    // Référence : le chemin exact est bien refusé.
    const exact = await api(API_DIRECTE, tech, bureau.orgA, 'POST', '/api/automations/events/lead-created', { leadId: d.client });
    expect(exact.status, `chemin exact : ${bref(exact)}`).toBe(403);

    for (const e of essais) {
      const avant = await activite(outils, e.type, idTech);
      const r = await api(API_DIRECTE, tech, bureau.orgA, 'POST', e.chemin, e.corps);
      const apres = await apresPatience(() => activite(outils, e.type, idTech), avant, r.status < 300 ? 8_000 : 1_000);
      expect.soft([401, 403, 404], `POST ${e.chemin} → ${bref(r)}`).toContain(r.status);
      expect.soft(apres - avant, `POST ${e.chemin} : aucun événement « ${e.type} » ne doit être émis au nom du technicien`).toBe(0);
    }
    // Et l'automatisation témoin n'a pas tourné.
    const { count: journaux } = await bureau.admin.from('automation_execution_logs').select('id', { count: 'exact', head: true }).eq('automation_rule_id', temoin);
    const { count: taches } = await bureau.admin.from('tasks').select('id', { count: 'exact', head: true }).eq('org_id', bureau.orgA).eq('title', `${outils.marque} tâche née d’un événement interdit`);
    expect.soft(journaux ?? 0, 'l’automatisation « Nouveau prospect » du bureau n’a pas été exécutée par un technicien').toBe(0);
    expect.soft(taches ?? 0, 'aucune tâche n’a été créée par l’automatisation').toBe(0);
    await bureau.admin.from('tasks').delete().eq('org_id', bureau.orgA).eq('title', `${outils.marque} tâche née d’un événement interdit`);
  });

  test('[S-02] « Construire avec Lumi » : le même appel avec une barre finale, une autre casse ou une double barre reste refusé (403) à un technicien et à un membre en lecture seule', async ({ jeton, bureau }) => {
    const corps = { demande: 'Envoie un texto de bienvenue à chaque nouveau prospect.', langue: 'fr' };
    for (const role of ['techA', 'lecteurA'] as const) {
      const j = await jeton(role);
      const exact = await api(API_DIRECTE, j, bureau.orgA, 'POST', '/api/automations/rules/generer', corps);
      expect(exact.status, `${role}, chemin exact : ${bref(exact)}`).toBe(403);
      for (const chemin of ['/api/automations/rules/generer/', '/api/automations/rules/GENERER', '/api/Automations/rules/generer', '/API/automations/rules/generer', '/api//automations/rules/generer', '/api/automations/rules/generer/?x=1']) {
        const r = await api(API_DIRECTE, j, bureau.orgA, 'POST', chemin, corps);
        // Atteindre le générateur (422 « Lumi n'est pas configuré » ici, un appel au modèle facturé au bureau en production) = garde contournée.
        expect.soft(r.status, `${role} · POST ${chemin} → ${bref(r)}`).toBe(403);
      }
    }
  });

  test('[S-02] lectures : par un chemin équivalent, un technicien reçoit 403 comme par le chemin exact', async ({ jeton, outils, bureau }) => {
    const tech = await jeton('techA');
    const regle = await regleA(outils, 'cible lecture');
    for (const chemin of [
      '/api/automations/rules/', '/api/AUTOMATIONS/rules', '/api/automations/pause/', '/api/automations/templates/',
      `/api/automations/editeur/?rule_id=${regle}`, '/api/automations/rules/stats/', '/api/automations/folders/', '/api/automations/webhooks/', '/api/automations/bureaux-cibles/',
    ]) {
      const r = await api(API_DIRECTE, tech, bureau.orgA, 'GET', chemin);
      expect.soft(r.status, `GET ${chemin} → ${bref(r)}`).toBe(403);
      // Quoi qu'il arrive, aucune règle du bureau ne doit sortir (la RLS tient).
      expect.soft(r.texte.includes(regle), `GET ${chemin} : la règle du bureau A ne doit pas être rendue`).toBe(false);
    }
  });

  test('[S-02] écritures : par un chemin équivalent, la RLS refuse quand même — rien n’est écrit par un technicien', async ({ jeton, outils, bureau }) => {
    test.setTimeout(300_000);
    const tech = await jeton('techA');
    const regle = await regleA(outils, 'cible écriture', { actions: [{ type: 'create_task', config: { title: 'Rappeler' } }] });
    const nomCree = `${outils.marque} créée par contournement`;
    const essais: Array<[string, string, unknown?]> = [
      ['POST', '/api/automations/rules/', { name: nomCree, trigger_event: 'lead.created', delay_seconds: 0, actions: [{ type: 'log_activity', config: {} }] }],
      ['PATCH', `/api/automations/rules/${regle}/`, { description: 'contournée' }],
      ['POST', `/api/automations/rules/${regle}/publication/`, { actif: true }],
      ['POST', `/api/automations/rules/${regle}/duplicate/`],
      ['DELETE', `/api/automations/rules/${regle}/`],
      ['POST', '/api/automations/pause/', { paused: true }],
      ['POST', '/api/automations/folders/', { name: `${outils.marque} dossier`.slice(0, 60) }],
      ['POST', '/api/automations/webhooks/', { name: `${outils.marque} adresse` }],
    ];
    for (const [methode, chemin, corps] of essais) {
      const r = await api(API_DIRECTE, tech, bureau.orgA, methode, chemin, corps);
      expect.soft([403, 404], `${methode} ${chemin} → ${bref(r)}`).toContain(r.status);
    }
    const { data: apres } = await bureau.admin.from('automation_rules').select('description, is_active, deleted_at').eq('id', regle).maybeSingle();
    expect(apres, 'la règle cible est intacte').toEqual({ description: '', is_active: false, deleted_at: null });
    const { count: regles } = await bureau.admin.from('automation_rules').select('id', { count: 'exact', head: true }).eq('org_id', bureau.orgA).ilike('name', `%${outils.marque}%`);
    expect(regles, 'ni création ni copie').toBe(1);
    const { count: dossiers } = await bureau.admin.from('automation_folders').select('id', { count: 'exact', head: true }).eq('org_id', bureau.orgA).ilike('name', `%${outils.marque}%`);
    const { count: adresses } = await bureau.admin.from('automation_webhooks').select('id', { count: 'exact', head: true }).eq('org_id', bureau.orgA).ilike('name', `%${outils.marque}%`);
    expect([dossiers, adresses]).toEqual([0, 0]);
    const { data: cs } = await bureau.admin.from('company_settings').select('automations_paused').eq('org_id', bureau.orgA).maybeSingle();
    expect(cs?.automations_paused === true, 'les automatisations ne sont pas en pause').toBe(false);
  });

  test('[S-02] sans jeton : une route d’événement appelée avec une barre finale répond 401, comme par le chemin exact', async ({ bureau }) => {
    for (const nom of ['invoice-paid', 'appointment-created', 'appointment-cancelled', 'quote-approved']) {
      const exact = await api(API_DIRECTE, null, null, 'POST', `/api/automations/events/${nom}`, {});
      expect.soft(exact.status, `POST …/${nom} sans jeton → ${bref(exact)}`).toBe(401);
      const r = await api(API_DIRECTE, null, null, 'POST', `/api/automations/events/${nom}/`, {});
      expect.soft(r.status, `POST …/${nom}/ sans jeton → ${bref(r)}`).toBe(401);
    }
    // Les routes qui s'authentifient elles-mêmes tiennent.
    const r = await api(API_DIRECTE, null, null, 'POST', '/api/automations/events/lead-created/', { leadId: bureau.orgA });
    expect(r.status).toBe(401);
  });

  test('[S-02] ce qui ne contourne PAS la garde : paramètres de requête (403), « %2F » (404) et double barre initiale (403, ramenée au chemin exact)', async ({ jeton, bureau, baseURL }) => {
    const tech = await jeton('techA');
    const corps = { demande: 'Envoie un texto de bienvenue à chaque nouveau prospect.', langue: 'fr' };
    const q = await api(API_DIRECTE, tech, bureau.orgA, 'POST', '/api/automations/rules/generer?x=1', corps);
    expect(q.status, bref(q)).toBe(403);
    const pct = await api(API_DIRECTE, tech, bureau.orgA, 'POST', '/api/automations/rules%2Fgenerer', corps);
    expect(pct.status, bref(pct)).toBe(404);
    // Depuis #862 (server/lib/chemin-canonique.ts), les barres doublées sont réduites AVANT les gardes :
    // « //api/… » est le chemin exact, donc refusé par la garde de permission (403) et non plus « introuvable » (404).
    const dbl = await api(API_DIRECTE, tech, bureau.orgA, 'POST', '//api/automations/rules/generer', corps);
    expect(dbl.status, bref(dbl)).toBe(403);
    expect(erreurDe(dbl)).toBe('Permission denied: automations.update');
    // Par le mandataire de développement aussi, le chemin exact est refusé.
    const vite = await api(baseURL!, tech, bureau.orgA, 'POST', '/api/automations/rules/generer', corps); // baseURL fixé par la config
    expect(vite.status).toBe(403);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// S-04 — ce que la base laisse faire directement
// ════════════════════════════════════════════════════════════════════════════

test.describe('S-04 — écritures directes par PostgREST avec `automations.update`', () => {
  test('[S-04] publier directement en base un parcours que le serveur refuse de publier est refusé', async ({ jeton, outils, bureau }) => {
    const id = await regleA(outils, 'texto vide', { actions: [{ type: 'send_sms', config: { body: '' } }] });
    // Référence : la route de publication refuse ce parcours.
    const route = await api(API_DIRECTE, await jeton('adminA'), bureau.orgA, 'POST', `/api/automations/rules/${id}/publication`, { actif: true });
    expect(route.status, bref(route)).toBe(422);
    expect(erreurDe(route)).toContain('Publication refusée');
    // Le même changement, écrit directement dans la table par l'admin puis par le membre « read + update ».
    for (const role of ['adminA', 'editeurA'] as const) {
      await clientDe(await jeton(role)).from('automation_rules').update({ is_active: true }).eq('id', id);
      const { data } = await bureau.admin.from('automation_rules').select('is_active').eq('id', id).maybeSingle();
      expect.soft(data?.is_active, `${role} : la règle au texto vide ne doit pas pouvoir être publiée par PostgREST`).toBe(false);
      await bureau.admin.from('automation_rules').update({ is_active: false }).eq('id', id);
    }
  });

  /* Constat roles-06, scindé en deux le 2026-10-01 (tri sur la pile locale) : la garde en base de #889 refuse
     `is_preset` / `preset_key` (vert), mais laisse encore écrire un déclencheur hors catalogue sur SA règle
     (rouge). Un seul test rouge aurait caché une régression de la partie corrigée. Mêmes écritures, mêmes
     attentes qu'avant la scission. */
  test('[S-04] `is_preset` et `preset_key` ne se réécrivent pas directement en base', async ({ jeton, outils, bureau }) => {
    const id = await regleA(outils, 'colonnes protégées');
    const sb = clientDe(await jeton('editeurA'));
    const maj = await sb.from('automation_rules').update({ is_preset: true, preset_key: 'invente_par_le_navigateur' }).eq('id', id);
    const { data } = await bureau.admin.from('automation_rules').select('is_preset, preset_key, trigger_event').eq('id', id).maybeSingle();
    expect.soft(data?.is_preset, 'une règle ne devient pas « fournie » par une écriture du navigateur').toBe(false);
    expect.soft(data?.preset_key ?? null, 'la clé de préréglage ne s’invente pas').toBeNull();
    // La base le REFUSE (elle ne l'ignore pas en silence) : garde `trg_automation_rules_garde`, 42501.
    expect.soft(maj.error?.code ?? '', `refus de la base : ${maj.error?.message ?? 'aucune erreur'}`).toBe('42501');
  });

  test('[S-04] un déclencheur hors catalogue ne s’écrit pas directement en base, même sur sa propre règle @defaut', async ({ jeton, outils, bureau }) => {
    const id = await regleA(outils, 'déclencheur protégé');
    const sb = clientDe(await jeton('editeurA'));
    await sb.from('automation_rules').update({ trigger_event: 'declencheur.inexistant' }).eq('id', id);
    const { data } = await bureau.admin.from('automation_rules').select('trigger_event').eq('id', id).maybeSingle();
    expect.soft(data?.trigger_event, 'un déclencheur hors catalogue est refusé (le serveur valide `trigger_event` contre le catalogue)').toBe('lead.created');
  });

  test('[S-04] une automatisation FOURNIE (préréglage) ne se met pas à la corbeille, ne se purge pas et ne se supprime pas en direct, comme le serveur l’interdit', async ({ jeton, outils, bureau }) => {
    const cle = `e2e_${outils.marque.replace(/[^a-z0-9]/gi, '').toLowerCase()}`;
    const id = await regleA(outils, 'préréglage', { is_preset: true, preset_key: cle });
    // Référence : le serveur refuse de supprimer un préréglage.
    const route = await api(API_DIRECTE, await jeton('adminA'), bureau.orgA, 'DELETE', `/api/automations/rules/${id}`);
    expect(route.status, bref(route)).toBe(400);
    expect(erreurDe(route)).toContain('ne se supprime pas');

    const sb = clientDe(await jeton('editeurA'));
    await sb.from('automation_rules').update({ deleted_at: new Date().toISOString(), purged_at: new Date().toISOString() }).eq('id', id);
    const { data: apresMaj } = await bureau.admin.from('automation_rules').select('deleted_at, purged_at').eq('id', id).maybeSingle();
    expect.soft(apresMaj?.deleted_at ?? null, 'le préréglage n’est pas à la corbeille').toBeNull();
    expect.soft(apresMaj?.purged_at ?? null, 'le préréglage n’est pas purgé').toBeNull();

    await sb.from('automation_rules').delete().eq('id', id);
    const { data: apresSuppr } = await bureau.admin.from('automation_rules').select('id').eq('id', id).maybeSingle();
    expect.soft(apresSuppr, 'la ligne du préréglage existe toujours après un DELETE par PostgREST').not.toBeNull();
  });

  test('[S-04][S-13] le texte d’un message écrit en direct est borné comme par le serveur (1 600 caractères pour un texto, jamais vide sur une règle publiée) @defaut', async ({ jeton, outils, bureau }) => {
    const id = await regleA(outils, 'texto publié', { is_active: true, actions: [{ type: 'send_sms', config: { body: 'Bonjour {{client_first_name}}' } }] });
    const long = 'x'.repeat(5000);
    // Référence : le serveur refuse 5 000 caractères.
    const route = await api(API_DIRECTE, await jeton('adminA'), bureau.orgA, 'PATCH', `/api/automations/rules/${id}`, { actions: [{ type: 'send_sms', config: { body: long } }] });
    expect(route.status, bref(route)).toBe(400);
    // Le navigateur écrit `actions` par PostgREST (src/lib/automationRulesApi.ts → updateRuleMessage) : même changement, sans le serveur.
    const sb = clientDe(await jeton('editeurA'));
    await sb.from('automation_rules').update({ actions: [{ type: 'send_sms', config: { body: long } }] }).eq('id', id);
    const { data: a1 } = await bureau.admin.from('automation_rules').select('actions').eq('id', id).maybeSingle();
    const corps1 = String(((a1?.actions as Array<{ config?: { body?: string } }> | null) ?? [])[0]?.config?.body ?? '');
    expect.soft(corps1.length, 'un texto de 5 000 caractères ne doit pas pouvoir être enregistré').toBeLessThanOrEqual(1600);
    await sb.from('automation_rules').update({ actions: [{ type: 'send_sms', config: { body: '' } }] }).eq('id', id);
    const { data: a2 } = await bureau.admin.from('automation_rules').select('actions, is_active').eq('id', id).maybeSingle();
    const corps2 = String(((a2?.actions as Array<{ config?: { body?: string } }> | null) ?? [])[0]?.config?.body ?? '');
    expect.soft(a2?.is_active === true && corps2 === '', 'une règle PUBLIÉE ne doit pas pouvoir se retrouver avec un texto vide').toBe(false);
  });

  test('[S-04] ce que la base refuse bien : déplacer une règle vers un autre bureau, ou en insérer une chez lui', async ({ jeton, outils, bureau }) => {
    const id = await regleA(outils, 'reste chez A');
    const sb = clientDe(await jeton('adminA'));
    const deplace = await sb.from('automation_rules').update({ org_id: bureau.orgB }).eq('id', id).select('id');
    // Depuis #889 (20261007300000_automation_rules_garde.sql), le déclencheur de garde passe AVANT la RLS :
    // même code 42501, mais c'est lui qui répond (« Le bureau et le statut « fournie »… ne se modifient pas. »).
    expect(deplace.error?.code ?? '', 'changer org_id est refusé par la base').toBe('42501');
    expect(deplace.error?.message ?? '', 'changer org_id est refusé par la garde en base').toContain('Le bureau et le statut « fournie » d’une automatisation ne se modifient pas.');
    // `is_active: false` explicite : la colonne vaut `true` par défaut, et la garde de #889 refuserait alors
    // l'insertion AVANT la RLS (« Une automatisation naît en brouillon ») — on veut prouver que, même pour un
    // brouillon que la garde laisse passer, la RLS refuse d'écrire dans le bureau d'un autre.
    const insere = await sb.from('automation_rules').insert({ org_id: bureau.orgB, name: `${outils.marque} chez B`, trigger_event: 'lead.created', actions: [], is_active: false }).select('id');
    expect(insere.error?.code ?? '').toBe('42501');
    expect(insere.error?.message ?? '').toContain('row-level security');
    const { data } = await bureau.admin.from('automation_rules').select('org_id').eq('id', id).maybeSingle();
    expect(data?.org_id).toBe(bureau.orgA);
    const { count } = await bureau.admin.from('automation_rules').select('id', { count: 'exact', head: true }).eq('org_id', bureau.orgB).ilike('name', `%${outils.marque}%`);
    expect(count).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// S-05 — la corbeille
// ════════════════════════════════════════════════════════════════════════════

test.describe('S-05 — la corbeille est respectée par toutes les routes', () => {
  const PUBLIABLE = { actions: [{ type: 'create_task', config: { title: 'Rappeler le prospect' } }] };

  test('[S-05] `PATCH /rules/:id { is_active: true }` sur une règle à la corbeille est refusé, comme la route de publication', async ({ jeton, outils, bureau }) => {
    const id = await regleA(outils, 'à la corbeille', { ...PUBLIABLE, deleted_at: new Date().toISOString() });
    const admin = await jeton('adminA');
    // Référence : la route de publication dit de restaurer d'abord.
    const pub = await api(API_DIRECTE, admin, bureau.orgA, 'POST', `/api/automations/rules/${id}/publication`, { actif: true });
    expect(pub.status, bref(pub)).toBe(422);
    expect(erreurDe(pub)).toContain('corbeille');
    const r = await api(API_DIRECTE, admin, bureau.orgA, 'PATCH', `/api/automations/rules/${id}`, { is_active: true });
    const { data } = await bureau.admin.from('automation_rules').select('is_active, deleted_at').eq('id', id).maybeSingle();
    expect.soft([404, 409, 422], `PATCH → ${bref(r)}`).toContain(r.status);
    expect.soft(data?.is_active, 'une règle à la corbeille ne peut pas être « publiée »').toBe(false);
  });

  test('[S-05] dupliquer une règle supprimée DÉFINITIVEMENT est refusé (404) : elle ne ressuscite pas', async ({ jeton, outils, bureau }) => {
    const quand = new Date().toISOString();
    const id = await regleA(outils, 'purgée', { ...PUBLIABLE, deleted_at: quand, purged_at: quand });
    const r = await api(API_DIRECTE, await jeton('adminA'), bureau.orgA, 'POST', `/api/automations/rules/${id}/duplicate`);
    const { count } = await bureau.admin.from('automation_rules').select('id', { count: 'exact', head: true }).eq('org_id', bureau.orgA).ilike('name', `%${outils.marque}%`);
    expect.soft(r.status, `duplicate → ${bref(r)}`).toBe(404);
    expect.soft(count, 'aucune copie n’est née d’une règle supprimée définitivement').toBe(1);
  });

  test('[S-05] « Tester » (aperçu) une règle à la corbeille est refusé', async ({ jeton, outils, bureau }) => {
    const id = await regleA(outils, 'corbeille aperçu', { ...PUBLIABLE, deleted_at: new Date().toISOString() });
    const r = await api(API_DIRECTE, await jeton('adminA'), bureau.orgA, 'POST', `/api/automations/rules/${id}/apercu`);
    expect([404, 409, 422], `apercu → ${bref(r)}`).toContain(r.status);
  });

  test('[S-05] ce qui tient : restaurer ou rouvrir une règle supprimée définitivement répond « introuvable »', async ({ jeton, outils, bureau }) => {
    const quand = new Date().toISOString();
    const id = await regleA(outils, 'purgée 2', { ...PUBLIABLE, deleted_at: quand, purged_at: quand });
    const admin = await jeton('adminA');
    const rest = await api(API_DIRECTE, admin, bureau.orgA, 'POST', `/api/automations/rules/${id}/restaurer`);
    expect(rest.status, bref(rest)).toBe(404);
    expect(erreurDe(rest)).toBe('Automatisation introuvable dans la corbeille.');
    const ed = await api(API_DIRECTE, admin, bureau.orgA, 'GET', `/api/automations/editeur?rule_id=${id}`);
    expect(ed.status).toBe(200);
    expect((ed.json as { rule: unknown }).rule, 'une règle purgée n’est plus servie à l’éditeur').toBeNull();
    const liste = await api(API_DIRECTE, admin, bureau.orgA, 'GET', '/api/automations/rules');
    expect(liste.texte.includes(id), 'ni dans la liste').toBe(false);
    const { data } = await bureau.admin.from('automation_rules').select('deleted_at, purged_at').eq('id', id).maybeSingle();
    expect(data?.purged_at, 'elle reste purgée').not.toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// S-06 — la route de diagnostic
// ════════════════════════════════════════════════════════════════════════════

test.describe('S-06 — GET /api/automations/test', () => {
  test('[S-06] la batterie de diagnostic ne renvoie à un admin de bureau AUCUNE information de la plateforme (compte SMTP, SID et numéro Twilio)', async ({ jeton, bureau }) => {
    test.setTimeout(300_000);
    const r = await api(API_DIRECTE, await jeton('adminA'), bureau.orgA, 'GET', '/api/automations/test');
    expect(r.status, bref(r)).toBe(200);
    const resultats = ((r.json as { results?: Array<{ name: string; details: string }> }).results ?? []);
    const smtp = resultats.find((x) => x.name === 'SMTP email configured');
    const twilio = resultats.find((x) => x.name === 'Twilio SMS configured');
    // Sur cette instance : SMTP_USER = « piege@lume-qa.test » (fournisseur factice), Twilio vide.
    // En production la même ligne rend l'utilisateur SMTP réel, et « SID=<8 premiers caractères>…, Phone=<numéro Twilio de la plateforme> ».
    expect.soft(smtp?.details ?? '', 'le compte SMTP de la plateforme ne doit pas être rendu à un client').not.toMatch(/SMTP user:\s*\S+/);
    expect.soft(r.texte, 'aucune valeur de variable d’environnement de la plateforme dans la réponse').not.toContain('piege@lume-qa.test');
    expect.soft(twilio?.details ?? '', 'ni SID ni numéro Twilio de la plateforme').not.toMatch(/SID=|Phone=/);
  });

  test('[S-06] la route reste fermée à qui n’est ni propriétaire ni admin, quelle que soit sa surcharge', async ({ jeton, bureau }) => {
    for (const role of ['editeurA', 'lecteurA', 'vendeurA', 'techA'] as const) {
      const r = await api(API_DIRECTE, await jeton(role), bureau.orgA, 'GET', '/api/automations/test');
      expect.soft(r.status, `${role} → ${bref(r)}`).toBe(403);
      expect.soft(r.texte).not.toContain('results');
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// S-08 — « Tout arrêter », la langue des messages, la langue des refus
// ════════════════════════════════════════════════════════════════════════════

test.describe('S-08 — `automations.update` sans le rôle admin', () => {
  test('[S-08] le membre « read + update » non admin ne peut ni arrêter les automatisations ni changer la langue des messages : refus clair en français, rien n’est écrit', async ({ jeton, bureau }) => {
    const j = await jeton('editeurA');
    await bureau.admin.from('company_settings').update({ automations_paused: false, automations_paused_at: null, automations_paused_by: null, default_language: 'fr' }).eq('org_id', bureau.orgA);
    const r = await api(API_DIRECTE, j, bureau.orgA, 'POST', '/api/automations/pause', { paused: true });
    expect(r.status, bref(r)).toBe(403);
    expect(erreurDe(r)).toBe('Seul un administrateur peut arrêter les automatisations. Rien n’a été arrêté.');
    // Et directement en base (c'est par là que l'interface écrit la langue).
    const sb = clientDe(j);
    const maj = await sb.from('company_settings').update({ automations_paused: true, default_language: 'en' }).eq('org_id', bureau.orgA).select('org_id');
    expect((maj.data ?? []).length, 'la base ne modifie aucune ligne pour un non-admin').toBe(0);
    const { data } = await bureau.admin.from('company_settings').select('automations_paused, default_language').eq('org_id', bureau.orgA).maybeSingle();
    expect(data).toEqual({ automations_paused: false, default_language: 'fr' });
  });

  test('[S-08] un refus de permission du serveur est dit en français à un compte en français, sans nom de clé technique', async ({ jeton, outils, bureau }) => {
    const r = await api(API_DIRECTE, await jeton('lecteurA'), bureau.orgA, 'POST', '/api/automations/rules',
      { name: `${outils.marque} refusée`, trigger_event: 'lead.created', delay_seconds: 0, actions: [{ type: 'log_activity', config: {} }] }, { 'Accept-Language': 'fr-CA' });
    expect(r.status).toBe(403);
    /* Depuis #870 (server/lib/refus-permission.ts) le refus porte DEUX textes : `error`, le texte technique gardé
       exprès comme contrat (« Permission denied: automations.update »), et `message` / `message_en`, la phrase
       lisible. Le toast affiche `message` (src/lib/messageDuServeur.ts : `message`, sinon `error`) — c'est donc
       ce texte-là, celui que l'utilisateur lit, qui ne doit plus être de l'anglais technique. */
    const corps = (r.json ?? {}) as { error?: string; message?: string; message_en?: string; permission?: string };
    const affiche = corps.message ?? corps.error ?? '';
    expect.soft(affiche, 'le refus affiché ne doit pas être de l’anglais technique').not.toMatch(/Permission denied|automations\.(read|update)/);
    expect.soft(affiche, 'la phrase affichée à un compte en français').toBe('Votre rôle ne permet pas de modifier les automatisations.');
    // Interface en anglais : `message_en`, sans nom de clé non plus.
    expect.soft(corps.message_en ?? '', 'la phrase affichée à un compte en anglais').toBe('Your role does not allow editing automations.');
    // Le contrat technique reste, à part, pour le code.
    expect.soft(erreurDe(r)).toBe('Permission denied: automations.update');
    expect.soft(corps.permission).toBe('automations.update');
    // Rien n'a été créé.
    const { count } = await bureau.admin.from('automation_rules').select('id', { count: 'exact', head: true }).eq('org_id', bureau.orgA).eq('name', `${outils.marque} refusée`);
    expect(count ?? 0, 'aucune règle n’est née du refus').toBe(0);
  });

  test('[S-08][S-06] les autres refus du module sont en français aussi (« Only admins can run automation tests. », « eventId is required ») @defaut', async ({ jeton, bureau }) => {
    const t = await api(API_DIRECTE, await jeton('editeurA'), bureau.orgA, 'GET', '/api/automations/test', undefined, { 'Accept-Language': 'fr-CA' });
    expect(t.status).toBe(403);
    expect.soft(erreurDe(t)).not.toMatch(/Only admins/);
    const e = await api(API_DIRECTE, await jeton('proprioA'), bureau.orgA, 'POST', '/api/automations/events/appointment-rescheduled', {}, { 'Accept-Language': 'fr-CA' });
    expect(e.status).toBe(400);
    expect.soft(erreurDe(e)).not.toMatch(/is required/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// S-17, S-18
// ════════════════════════════════════════════════════════════════════════════

test.describe('S-17 — la clé d’une adresse d’appel', () => {
  test('[S-17] la clé complète n’est lisible par PostgREST pour AUCUN rôle, et ne se choisit pas à l’insertion', async ({ jeton, outils, bureau }) => {
    const { data: w, error } = await bureau.admin.from('automation_webhooks').insert({ org_id: bureau.orgA, name: `${outils.marque} clé` }).select('id, api_key').single();
    if (error || !w) throw new Error(`préparation : ${error?.message}`);
    try {
      for (const role of ['proprioA', 'adminA', 'editeurA', 'lecteurA', 'techA', 'proprioB'] as const) {
        const sb = clientDe(await jeton(role));
        const cle = await sb.from('automation_webhooks').select('api_key').eq('id', w.id);
        const tout = await sb.from('automation_webhooks').select('*').eq('id', w.id);
        expect.soft(JSON.stringify([cle.data, tout.data]), `${role} : la clé ne sort pas`).not.toContain(String(w.api_key));
        expect.soft(cle.error?.message ?? '', `${role} : lire api_key est refusé`).toContain('permission denied');
      }
      const choisie = await clientDe(await jeton('adminA')).from('automation_webhooks').insert({ org_id: bureau.orgA, name: `${outils.marque} clé choisie`, api_key: 'a'.repeat(64) }).select('id');
      expect(choisie.error?.message ?? '').toContain('permission denied');
      // Par l'API : la liste ne rend que les 4 derniers caractères.
      const liste = await api(API_DIRECTE, await jeton('lecteurA'), bureau.orgA, 'GET', '/api/automations/webhooks');
      expect(liste.status).toBe(200);
      expect(liste.texte).not.toContain(String(w.api_key));
      expect(liste.texte).toContain(String(w.api_key).slice(-4));
    } finally {
      await bureau.admin.from('automation_webhooks').delete().in('org_id', [bureau.orgA, bureau.orgB]).ilike('name', `%${outils.marque}%`);
    }
  });
});

test.describe('S-18 — événement sur l’objet d’un autre bureau', () => {
  test('[S-18] `deal-stage-changed` avec un identifiant qui n’appartient pas au bureau de l’appelant est refusé (404), comme les autres routes d’événements @defaut', async ({ jeton, outils, bureau }) => {
    // Le propriétaire de B annonce un changement d'étape sur un objet du bureau A.
    const idB = bureau.comptes.proprioB.id;
    const compter = async (org: string) => {
      const { count } = await bureau.admin.from('activity_log').select('id', { count: 'exact', head: true }).eq('org_id', org).eq('event_type', 'deal_stage_changed').eq('actor_id', idB);
      return count ?? 0;
    };
    const avantA = await compter(bureau.orgA); const avantB = await compter(bureau.orgB);
    const r = await api(API_DIRECTE, await jeton('proprioB'), bureau.orgB, 'POST', '/api/automations/events/deal-stage-changed', { dealId: outils.decor.client, leadId: outils.decor.client, oldStage: 'a', newStage: 'b' });
    const apresB = await apresPatience(() => compter(bureau.orgB), avantB, r.status < 300 ? 8_000 : 1_000);
    // Quoi qu'il arrive : RIEN dans le bureau A.
    expect(await compter(bureau.orgA), 'aucune trace dans le bureau A').toBe(avantA);
    // Référence : la route voisine relit l'objet et répond 404.
    const voisin = await api(API_DIRECTE, await jeton('proprioB'), bureau.orgB, 'POST', '/api/automations/events/lead-created', { leadId: outils.decor.client });
    expect(voisin.status).toBe(404);
    expect.soft(r.status, `deal-stage-changed → ${bref(r)}`).toBe(404);
    expect.soft(apresB - avantB, 'aucun événement n’est consigné dans le bureau B pour un deal qui n’est pas le sien').toBe(0);
  });
});
