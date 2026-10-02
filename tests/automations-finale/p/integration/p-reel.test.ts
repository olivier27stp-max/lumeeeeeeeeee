/**
 * Agent P — les mêmes pièces, contre la VRAIE base (pile LOCALE, mes bureaux « (p) » en bac à sable).
 *
 *   QA_AUTO_SUFFIXE=p npx vitest run --maxWorkers=2 --config tests/automations-finale/p/vitest.config.ts
 *
 * Une fausse base ne prouve ni qu'une requête PostgREST est bien formée (une seule colonne
 * inexistante fait échouer toute la lecture, en silence), ni que l'index unique tranche
 * entre deux consommateurs réellement simultanés, ni que la RLS laisse lire ce que la route
 * lit avec la session de l'utilisateur. Ici :
 *   · ciblageOk et apercuCiblage sur de vraies fiches, étiquettes et champs ;
 *   · la garde des doublons : la réservation sous l'index unique, la lecture des 24 h ;
 *   · conflitsDePublication avec une vraie session ;
 *   · « Tester avec un client » avec les vraies variables du moteur — et rien d'écrit ;
 *   · les trois routes, vraie session, vraie RLS, vrai contrôle des droits.
 * Se saute tout seul hors de la pile locale (jamais staging, jamais la prod).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { SupabaseClient } from '@supabase/supabase-js';

const PILE_LOCALE = /localhost|127\.0\.0\.1/.test(process.env.VITE_SUPABASE_URL ?? '') && (process.env.QA_AUTO_SUFFIXE ?? '') === 'p';

type Bureau = { admin: SupabaseClient; orgA: string; orgB: string; users: Record<string, string> };
let b: Bureau;
let session: { jeton: string; client: SupabaseClient };
let sessionTech: { jeton: string; client: SupabaseClient };
const aNettoyer: Array<() => PromiseLike<unknown>> = [];
const m = `P${Date.now().toString(36)}`;
const clients: Record<'vip' | 'commercial' | 'vipExclu' | 'autre', string> = { vip: '', commercial: '', vipExclu: '', autre: '' };
let champRefere = '';
let champSansAvis = '';
let facture = '';
const TEL = { vip: '+15145550171', commercial: '+15145550172', vipExclu: '+15145550173', autre: '+15145550174' };

const ok = async <T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, quoi: string): Promise<T> => {
  const { data, error } = await p;
  if (error) throw new Error(`${quoi} : ${error.message}`);
  return data;
};

beforeAll(async () => {
  if (!PILE_LOCALE) return;
  const { assurerBureauTest, sessionDe, COMPTES } = await import('../../../automations-suite/harnais/bureau-test');
  b = await assurerBureauTest();
  session = await sessionDe(b.admin, COMPTES.proprioA.email);
  sessionTech = await sessionDe(b.admin, COMPTES.techA.email);
  const maintenant = new Date().toISOString();
  for (const [cle, prenom] of [['vip', 'Alice'], ['commercial', 'Benoît'], ['vipExclu', 'Chloé'], ['autre', 'David']] as const) {
    const c = await ok(b.admin.from('clients').insert({
      org_id: b.orgA, created_by: b.users.proprioA, first_name: prenom, last_name: m, status: 'active',
      email: `p-${cle.toLowerCase()}-${m.toLowerCase()}@lume-qa.test`, phone: TEL[cle], sms_consent_at: maintenant, email_consent_at: maintenant,
    }).select('id').single(), `client ${cle}`);
    clients[cle] = (c as { id: string }).id;
    aNettoyer.push(() => b.admin.from('clients').delete().eq('id', clients[cle]));
  }
  await ok(b.admin.from('client_tags').insert([
    { client_id: clients.vip, tag: `${m}-VIP` }, { client_id: clients.commercial, tag: `${m}-Commercial` },
    { client_id: clients.vipExclu, tag: `${m}-VIP` }, { client_id: clients.vipExclu, tag: `${m}-Ne pas relancer` },
  ]).select('id'), 'étiquettes');
  await ok(b.admin.from('sms_opt_outs').upsert({ org_id: b.orgA, phone: TEL.vipExclu, reason: 'STOP (test P)' }, { onConflict: 'org_id,phone' }).select('id'), 'STOP');
  aNettoyer.push(() => b.admin.from('sms_opt_outs').delete().eq('org_id', b.orgA).eq('phone', TEL.vipExclu));

  const champ = async (cle: string) => ((await ok(b.admin.from('custom_fields').select('id').eq('org_id', b.orgA).eq('object_type', 'client').eq('key', cle).is('archived_at', null).maybeSingle(), `champ ${cle}`)) as { id: string } | null)?.id ?? '';
  champRefere = await champ('refere_par');
  champSansAvis = await champ('noreview');
  const { ecrireValeurs } = await import('../../../../server/lib/champs/service');
  if (champRefere) await ecrireValeurs(b.admin, b.orgA, 'client', clients.vip, [{ field_id: champRefere, value: 'Commercial' }], { source: 'automation' });
  if (champSansAvis) await ecrireValeurs(b.admin, b.orgA, 'client', clients.commercial, [{ field_id: champSansAvis, value: true }], { source: 'automation' });

  const f = await ok(b.admin.from('invoices').insert({
    org_id: b.orgA, created_by: b.users.proprioA, invoice_number: `${m}-F1`, client_id: clients.vip, status: 'sent',
    subtotal_cents: 10000, total_cents: 11498, due_date: new Date(Date.now() - 3 * 86400_000).toISOString().slice(0, 10),
  }).select('id').single(), 'facture');
  facture = (f as { id: string }).id;
  aNettoyer.push(() => b.admin.from('invoices').delete().eq('id', facture));
});

afterAll(async () => {
  if (!PILE_LOCALE) return;
  for (const f of aNettoyer.reverse()) {
    try { await f(); } catch (e) { console.error('[ménage P]', e instanceof Error ? e.message : e); }
  }
});

const ciblage = () => ({
  inclure: { mode: 'une' as const, regles: [{ type: 'etiquette' as const, valeur: `${m}-vip` }, { type: 'etiquette' as const, valeur: `${m}-Commercial` }] },
  exclure: [{ type: 'etiquette' as const, valeur: `${m}-Ne pas relancer` }],
});

describe.skipIf(!PILE_LOCALE)('P (vraie base) — ciblage', () => {
  it('ciblageOk : VIP OU Commercial, sauf « Ne pas relancer » — sur les vraies étiquettes', async () => {
    const { ciblageOk } = await import('../../../../server/lib/automations-ciblage');
    const verdict = async (id: string) => (await ciblageOk(b.admin, b.orgA, 'client', id, { ciblage: ciblage() })).cible;
    expect({ vip: await verdict(clients.vip), commercial: await verdict(clients.commercial), vipExclu: await verdict(clients.vipExclu), autre: await verdict(clients.autre) })
      .toEqual({ vip: true, commercial: true, vipExclu: false, autre: false });
    expect(await ciblageOk(b.admin, b.orgA, 'client', clients.vipExclu, { ciblage: ciblage() })).toMatchObject({
      phrase: `Ignoré : hors ciblage — exclu par l’étiquette « ${m}-Ne pas relancer »`, code: 'hors_ciblage',
    });
  });

  it('[mécanisme de E-04] une FACTURE est jugée sur un champ personnalisé de SON client', async () => {
    expect(champRefere, 'le champ de base « Référé par » doit exister dans le bureau').not.toBe('');
    const { ciblageOk } = await import('../../../../server/lib/automations-ciblage');
    const conditions = (valeur: string) => ({ days_overdue: 3, ciblage: { inclure: { mode: 'toutes', regles: [{ type: 'champ', field_id: champRefere, op: 'is', value: valeur }] }, exclure: [] } });
    expect((await ciblageOk(b.admin, b.orgA, 'invoice', facture, conditions('Commercial'))).cible).toBe(true);
    const non = await ciblageOk(b.admin, b.orgA, 'invoice', facture, conditions('Résidentiel'));
    expect(non).toMatchObject({ cible: false, phrase: 'Ignoré : hors ciblage — ne remplit pas la condition sur « Référé par »' });
    expect(non.erreur).toBeUndefined();
  });

  it('les anciennes clés d’étiquette donnent le même verdict que le moteur d’aujourd’hui (`conditionsEtiquettesOk`)', async () => {
    const { ciblageOk } = await import('../../../../server/lib/automations-ciblage');
    const { conditionsEtiquettesOk } = await import('../../../../server/lib/etiquettes');
    const conditions = { client_a_etiquette: `${m}-VIP`, client_sans_etiquette: `${m}-Ne pas relancer` };
    for (const id of Object.values(clients)) {
      expect((await ciblageOk(b.admin, b.orgA, 'client', id, conditions)).cible, id)
        .toBe(await conditionsEtiquettesOk(b.admin, async () => id, conditions));
    }
  });

  it('apercuCiblage, lu avec la SESSION du propriétaire (RLS) : le compte, STOP, « aucune demande d’avis », la liste', async () => {
    const { apercuCiblage } = await import('../../../../server/lib/automations-ciblage');
    const a = await apercuCiblage(session.client, b.orgA, {
      ciblage: { inclure: { mode: 'une', regles: [{ type: 'etiquette', valeur: `${m}-VIP` }, { type: 'etiquette', valeur: `${m}-Commercial` }] } },
      canaux: ['sms', 'email'], demandeAvis: true,
    });
    expect(a.total).toBe(3);
    expect(a.dont).toEqual({ stop_texto: 1, desabonnes_courriel: 0, sans_telephone: 0, sans_courriel: 0, sans_avis: champSansAvis ? 1 : 0 });
    expect(a.apercu.map((c) => [c.nom, c.empechements])).toEqual([
      [`Alice ${m}`, []], [`Benoît ${m}`, champSansAvis ? ['sans_avis'] : []], [`Chloé ${m}`, ['stop_texto']],
    ]);
    expect(a.tronque).toBe(false);
  });

  it('LE COMPTEUR = LE MOTEUR : même verdict par `ciblageOk` et par l’aperçu, pour chacun de mes clients', async () => {
    const { apercuCiblage, ciblageOk } = await import('../../../../server/lib/automations-ciblage');
    const a = await apercuCiblage(b.admin, b.orgA, { ciblage: ciblage() });
    const touches = new Set(a.candidats.map((c) => c.id));
    for (const [nom, id] of Object.entries(clients)) {
      expect(touches.has(id), nom).toBe((await ciblageOk(b.admin, b.orgA, 'client', id, { ciblage: ciblage() })).cible);
    }
    expect(a.total).toBe(2);
  });

  it('« tous les clients » compte exactement le carnet du bureau, et jamais l’autre bureau', async () => {
    const { apercuCiblage } = await import('../../../../server/lib/automations-ciblage');
    const { count } = await b.admin.from('clients').select('id', { count: 'exact', head: true }).eq('org_id', b.orgA).is('deleted_at', null);
    const a = await apercuCiblage(session.client, b.orgA, { ciblage: null, canaux: ['sms'] });
    expect(a.total).toBe(count);
    expect((await apercuCiblage(session.client, b.orgB, { ciblage: null })).total).toBe(0); // la RLS : pas membre du bureau B
  });
});

describe.skipIf(!PILE_LOCALE)('P (vraie base) — doublons', () => {
  const regles: string[] = [];
  const ctx = (rule: number, nom: string) => ({
    supabase: b.admin, orgId: b.orgA, entityType: 'client', entityId: clients.vip, ruleId: regles[rule], declencheur: 'note.added', nomRegle: nom, fuseau: 'America/Toronto',
  });
  const reservations = async () => (await ok(b.admin.from('automation_execution_logs').select('id, automation_rule_id, action_type, execution_key, result_success, result_data')
    .eq('org_id', b.orgA).eq('entity_id', clients.vip).eq('action_type', 'reservation'), 'réservations')) as Array<Record<string, any>>;

  beforeAll(async () => {
    for (const nom of ['un', 'deux', 'trois']) {
      const r = await ok(b.admin.from('automation_rules').insert({
        org_id: b.orgA, name: `${m} ${nom}`, trigger_event: 'note.added', conditions: {}, delay_seconds: 0, is_active: false, is_preset: false,
        actions: [{ type: 'send_sms', config: { body: 'Bonjour' } }],
      }).select('id').single(), 'règle');
      regles.push((r as { id: string }).id);
    }
    aNettoyer.push(() => b.admin.from('automation_execution_logs').delete().eq('org_id', b.orgA).eq('entity_id', clients.vip));
    aNettoyer.push(() => b.admin.from('automation_rules').delete().in('id', regles));
  });

  it('[mécanisme de E-27] deux consommateurs RÉELLEMENT simultanés, deux automatisations, même texto → un seul envoie', async () => {
    const { gardeDoublon } = await import('../../../../server/lib/actions/doublons');
    const texte = `${m} Bonjour Alice, petit rappel pour votre rendez-vous de demain.`;
    const [x, y] = await Promise.all([
      gardeDoublon(ctx(0, `${m} un`), 'sms', TEL.vip, texte),
      gardeDoublon(ctx(1, `${m} deux`), 'sms', TEL.vip, texte),
    ]);
    expect([x.doublon, y.doublon].sort()).toEqual([false, true]);
    expect([x, y].find((g) => g.doublon)?.phrase).toMatch(new RegExp(`^Ignoré : doublon de « ${m} (un|deux) », envoyé à \\d{1,2} h \\d{2}$`));
    const lignes = await reservations();
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({ action_type: 'reservation', result_success: true });
    expect(JSON.stringify(lignes[0].result_data)).not.toContain('5550171');
  });

  it('[mécanisme de E-20 / E-22] l’une après l’autre : identique → doublon ; reformulé sur la même fiche → doublon ; réellement différent → part', async () => {
    const { gardeDoublon } = await import('../../../../server/lib/actions/doublons');
    const base = `${m} Bonjour Alice, votre rendez-vous est confirmé pour demain 9 h. Merci !`;
    expect((await gardeDoublon(ctx(0, `${m} un`), 'sms', TEL.vip, base)).doublon).toBe(false);
    expect(await gardeDoublon(ctx(1, `${m} deux`), 'sms', '(514) 555-0171', base.toUpperCase())).toMatchObject({ doublon: true, motif: 'identique' });
    expect(await gardeDoublon(ctx(1, `${m} deux`), 'sms', TEL.vip, `${m} Bonjour Alice, votre rendez-vous est bien confirmé pour demain à 9 h. Merci.`))
      .toMatchObject({ doublon: true, motif: 'quasi_identique' });
    expect((await gardeDoublon(ctx(1, `${m} deux`), 'sms', TEL.vip, `${m} Votre facture est prête : vous pouvez la régler en ligne quand vous voulez.`)).doublon).toBe(false);
    // La même automatisation se suit ; un autre canal et un autre destinataire ne sont pas concernés.
    expect((await gardeDoublon(ctx(0, `${m} un`), 'sms', TEL.vip, base)).doublon).toBe(false);
    expect((await gardeDoublon(ctx(1, `${m} deux`), 'email', `p-vip-${m.toLowerCase()}@lume-qa.test`, base)).doublon).toBe(false);
    expect((await gardeDoublon(ctx(1, `${m} deux`), 'sms', TEL.commercial, base)).doublon).toBe(false);
  });

  it('`liberer()` rend la place (fournisseur en panne) : une autre automatisation peut envoyer le même texte', async () => {
    const { gardeDoublon } = await import('../../../../server/lib/actions/doublons');
    const texte = `${m} Message dont l’envoi échoue chez le fournisseur.`;
    const tentative = await gardeDoublon(ctx(0, `${m} un`), 'sms', TEL.vip, texte);
    expect(tentative.doublon).toBe(false);
    await tentative.liberer();
    expect((await reservations()).filter((l) => l.result_data?.reservation_liberee)).toHaveLength(1);
    expect((await gardeDoublon(ctx(2, `${m} trois`), 'sms', TEL.vip, texte)).doublon).toBe(false);
  });
});

describe.skipIf(!PILE_LOCALE)('P (vraie base) — conflits et essai', () => {
  let publiee = '';
  let brouillon = '';
  const corps = `${m} Bonjour [client_first_name], merci de votre demande. On vous rappelle très vite.`;

  beforeAll(async () => {
    const creer = async (nom: string, actif: boolean, plus: Record<string, unknown> = {}) => ((await ok(b.admin.from('automation_rules').insert({
      org_id: b.orgA, name: `${m} ${nom}`, trigger_event: 'note.added', conditions: {}, delay_seconds: 0, is_active: actif, is_preset: false,
      actions: [{ type: 'send_sms', config: { body: corps, type_envoi: 'transactionnel' } }], ...plus,
    }).select('id').single(), 'règle')) as { id: string }).id;
    publiee = await creer('Bienvenue A', true);
    brouillon = await creer('Bienvenue B', false);
    aNettoyer.push(() => b.admin.from('automation_rules').delete().in('id', [publiee, brouillon]));
  });

  it('[mécanisme de E-28] conflitsDePublication, avec la session de l’utilisateur : la copie est en conflit avec la publiée, qui est NOMMÉE', async () => {
    const { conflitsDePublication, avertissementsDeConflit } = await import('../../../../server/lib/automations-conflits');
    const { data: regle } = await session.client.from('automation_rules').select('id, name, trigger_event, conditions, steps, actions, preset_key').eq('id', brouillon).single();
    const conflits = (await conflitsDePublication(session.client, b.orgA, regle!)).filter((c) => c.nom.includes(m));
    expect(conflits).toEqual([{ regle_id: publiee, nom: `${m} Bienvenue A`, canaux: ['sms'], meme_message: true }]);
    expect(JSON.stringify(avertissementsDeConflit(conflits))).toContain(`${m} Bienvenue A`);
  });

  it('[mécanisme de E-29] ciblages disjoints : aucun conflit', async () => {
    const { conflitsDePublication } = await import('../../../../server/lib/automations-conflits');
    await b.admin.from('automation_rules').update({ conditions: { client_a_etiquette: `${m}-VIP` } }).eq('id', publiee);
    const conflits = await conflitsDePublication(session.client, b.orgA, {
      id: brouillon, trigger_event: 'note.added', conditions: { client_sans_etiquette: `${m}-VIP` }, actions: [{ type: 'send_sms', config: { body: corps } }],
    });
    expect(conflits.filter((c) => c.nom.includes(m))).toEqual([]);
    await b.admin.from('automation_rules').update({ conditions: {} }).eq('id', publiee);
  });

  it('« Tester avec un client » : les VRAIES variables du moteur (facture du client), le message exact — et RIEN d’écrit', async () => {
    const { essaiPourUnClient } = await import('../../../../server/lib/automations-essai');
    const compter = async () => {
      const n = async (table: string) => (await b.admin.from(table).select('id', { count: 'exact', head: true }).eq('org_id', b.orgA)).count ?? 0;
      return { journaux: await n('automation_execution_logs'), envois: await n('envois_simules'), taches: await n('automation_scheduled_tasks'), messages: await n('messages') };
    };
    const avant = await compter();
    const r = await essaiPourUnClient({
      lecture: session.client, admin: b.admin, orgId: b.orgA, clientId: clients.vip, fr: true,
      regle: {
        trigger_event: 'invoice.overdue', conditions: { days_overdue: 3, ciblage: ciblage() }, delay_seconds: 0, actions: [],
        steps: [
          { id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'Bonjour [client_first_name|là], la facture [invoice_number] de [invoice_total] est en retard : [invoice_link]', type_envoi: 'transactionnel' } }, suivant: 'e2' },
          { id: 'e2', type: 'attendre', delai_secondes: 3 * 86400, suivant: 'e3' },
          { id: 'e3', type: 'action', action: { type: 'send_email', config: { subject: 'Facture [invoice_number]', body: '<p>Bonjour [client_name], référé par {{client.refere_par}}.</p>', type_envoi: 'transactionnel' } } },
        ],
      } as never,
    });
    expect(r).not.toBeNull();
    expect(r!.fiche).toMatchObject({ type: 'invoice', id: facture, libelle: `Facture ${m}-F1` });
    expect(r!.ciblage).toEqual({ cible: true, raison: null });
    expect(r!.etapes.map((e) => [e.libelle, e.issue, e.sur_le_chemin])).toEqual([
      ['Envoyer un texto', 'partirait', 'oui'], ['Attendre 3 jours', 'attente', 'oui'], ['Envoyer un courriel', 'partirait', 'oui'],
    ]);
    const texto = r!.etapes[0].rendu!;
    expect(texto.destinataire).toBe(TEL.vip);
    // `[x|y]` attend le branchement du moteur ([E-44]) : aujourd'hui `resolveTemplate` le laisse tel quel — l'essai montre ce qui partirait VRAIMENT.
    // Le total est celui que la base a recalculé (sous-total 100 $, aucune ligne de taxe) — pas celui du test.
    expect(texto.texte).toMatch(new RegExp(`la facture ${m}-F1 de 100,00\\s\\$ est en retard`));
    expect(texto.texte).toMatch(/\/invoice\//);
    expect(r!.etapes[2].rendu).toMatchObject({ canal: 'email', objet: `Facture ${m}-F1` });
    expect(r!.etapes[2].rendu!.texte).toBe(`Bonjour Alice ${m}, référé par Commercial.`);
    expect(await compter()).toEqual(avant);
  });

  it('un client hors ciblage : l’essai le dit avec la phrase du journal ; un client d’un autre bureau : introuvable', async () => {
    const { essaiPourUnClient } = await import('../../../../server/lib/automations-essai');
    const regle = { trigger_event: 'note.added', conditions: { ciblage: ciblage() }, steps: [], actions: [{ type: 'send_sms', config: { body: 'Bonjour' } }], delay_seconds: 0 } as never;
    const exclu = await essaiPourUnClient({ lecture: session.client, admin: b.admin, orgId: b.orgA, clientId: clients.vipExclu, fr: true, regle });
    expect(exclu!.ciblage).toEqual({ cible: false, raison: `Ignoré : hors ciblage — exclu par l’étiquette « ${m}-Ne pas relancer »` });
    expect(exclu!.etapes[0]).toMatchObject({ issue: 'ignoree', raison: 'Client désabonné (texto)' });
    // Le technicien du bureau A ne voit pas le bureau B ; et un identifiant du bureau A demandé « dans » le bureau B n'existe pas.
    expect(await essaiPourUnClient({ lecture: session.client, admin: b.admin, orgId: b.orgB, clientId: clients.vip, fr: true, regle })).toBeNull();
  });
});

describe.skipIf(!PILE_LOCALE)('P (vraie base) — les trois routes, vraie session, vraie RLS', () => {
  let serveur: Server;
  let origine = '';
  let regle = '';

  beforeAll(async () => {
    const { default: routeur } = await import('../../../../server/routes/automation-ciblage');
    const app = express();
    app.use(express.json());
    app.use('/api', routeur);
    serveur = await new Promise<Server>((res) => { const s = app.listen(0, '127.0.0.1', () => res(s)); });
    origine = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
    const r = await ok(b.admin.from('automation_rules').insert({
      org_id: b.orgA, name: `${m} Route`, trigger_event: 'note.added', conditions: {}, delay_seconds: 0, is_active: false, is_preset: false,
      actions: [{ type: 'send_sms', config: { body: `${m} Bonjour [client_first_name], merci.`, type_envoi: 'transactionnel' } }],
    }).select('id').single(), 'règle');
    regle = (r as { id: string }).id;
    aNettoyer.push(() => b.admin.from('automation_rules').delete().eq('id', regle));
  });
  afterAll(async () => { if (serveur) await new Promise((res) => serveur.close(res)); });

  const appeler = async (methode: 'GET' | 'POST', chemin: string, jeton: string, corps?: unknown, org = b.orgA) => {
    const res = await fetch(`${origine}/api${chemin}`, {
      method: methode, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jeton}`, 'x-org-id': org, 'Accept-Language': 'fr' },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
    });
    return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, any> };
  };

  it('POST /ciblage/apercu : le propriétaire reçoit le compte et les noms ; le technicien est refusé (403)', async () => {
    const corps = { ciblage: { inclure: { mode: 'toutes', regles: [{ type: 'etiquette', valeur: `${m}-VIP` }] } }, canaux: ['sms'], demande_avis: false };
    const r = await appeler('POST', '/automations/ciblage/apercu', session.jeton, corps);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ total: 2, dont: { stop_texto: 1 }, tronque: false });
    expect(r.json.apercu.map((c: { nom: string }) => c.nom)).toEqual([`Alice ${m}`, `Chloé ${m}`]);
    const refus = await appeler('POST', '/automations/ciblage/apercu', sessionTech.jeton, corps);
    expect(refus.status).toBe(403);
    expect(refus.json.error).toBe('Permission denied: automations.read');
  });

  it('GET /rules/:id/conflits et POST /rules/:id/tester répondent pour le propriétaire ; un bureau dont il n’est pas membre ne lui rend rien', async () => {
    const conflits = await appeler('GET', `/automations/rules/${regle}/conflits`, session.jeton);
    expect(conflits.status).toBe(200);
    expect(Array.isArray(conflits.json.conflits)).toBe(true);
    const essai = await appeler('POST', `/automations/rules/${regle}/tester`, session.jeton, { client_id: clients.vip });
    expect(essai.status).toBe(200);
    expect(essai.json.etapes[0].rendu).toMatchObject({ canal: 'sms', destinataire: TEL.vip, texte: `${m} Bonjour Alice, merci.` });
    // `x-org-id` d'un bureau où il n'est pas membre : la session reste sur SON bureau (ou est refusée) — jamais les données de B.
    const ailleurs = await appeler('POST', '/automations/ciblage/apercu', session.jeton, {}, b.orgB);
    if (ailleurs.status === 200) {
      const { count } = await b.admin.from('clients').select('id', { count: 'exact', head: true }).eq('org_id', b.orgA).is('deleted_at', null);
      expect(ailleurs.json.total).toBe(count);
    } else {
      expect([401, 403]).toContain(ailleurs.status);
    }
  });
});
