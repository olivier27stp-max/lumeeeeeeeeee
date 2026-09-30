/**
 * Crédits Lumi (2026-09-30) — côté SERVEUR.
 *
 * 1 crédit = 3 ¢ US de coût API réel ; stockage en micro-crédits entiers ;
 * affichage arrondi vers le bas ; aucun montant en $ ne part vers un client.
 * Les garanties de la BASE (idempotence, ajout seul, 50 réservations
 * simultanées, périodes anniversaire) sont prouvées sur staging par
 * scripts/qa/eprouver-credits-lumi.mts (15/15).
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { CENTS_US_PAR_CREDIT, centsEnMicroCredits, creditsAffiches, creditsEnCents, etatDepuis } from '../server/lib/lumi/credits';
import { coutEnCents } from '../server/lib/lumi/tarifs';

const lire = (p: string) => readFileSync(p, 'utf8');

describe('conversion coût réel → crédits', () => {
  it('3 ¢ = 1 crédit ; 1 000 crédits = 3 000 ¢ de plafond interne', () => {
    expect(CENTS_US_PAR_CREDIT).toBe(3);
    expect(centsEnMicroCredits(3)).toBe(1_000_000);
    expect(creditsEnCents(1000)).toBe(3000);
  });

  it('un tour Sonnet SANS cache : tokens réels × tarif → crédits', () => {
    // 10 000 entrée × 2 $/M + 800 sortie × 10 $/M = 0,02 + 0,008 $ = 2,8 ¢
    const cents = coutEnCents('claude-sonnet-5', { input_tokens: 10_000, output_tokens: 800, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
    expect(cents).toBeCloseTo(2.8, 6);
    expect(centsEnMicroCredits(cents)).toBe(933_333);           // 0,93 crédit
  });

  it('le même tour AVEC cache : lecture au dixième, écriture au double — moins de crédits', () => {
    const sans = coutEnCents('claude-sonnet-5', { input_tokens: 10_000, output_tokens: 800, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
    const avec = coutEnCents('claude-sonnet-5', { input_tokens: 1_000, output_tokens: 800, cache_read_input_tokens: 9_000, cache_creation_input_tokens: 0 });
    // 1 000 × 2 + 9 000 × 0,2 + 800 × 10 = 0,002 + 0,0018 + 0,008 $ = 1,18 ¢
    expect(avec).toBeCloseTo(1.18, 6);
    expect(centsEnMicroCredits(avec)).toBeLessThan(centsEnMicroCredits(sans));
  });

  it('la voix (dictée Gemini 2.5 Pro) : tokens audio au tarif relevé', () => {
    // ~60 s d'audio ≈ 1 500 tokens + 60 de texte : 1 500 × 1,25 + 60 × 10 = 0,001875 + 0,0006 $ = 0,2475 ¢
    const cents = coutEnCents('gemini-2.5-pro', { input_tokens: 1_500, output_tokens: 60, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
    expect(cents).toBeCloseTo(0.2475, 6);
    expect(centsEnMicroCredits(cents)).toBe(82_500);           // 0,08 crédit
  });

  it('le taux du code est celui de la base (lumi_credit_taux, migration)', () => {
    const migration = lire('supabase/migrations/20261005200000_lumi_credits.sql');
    expect(migration).toMatch(/values \('2026-10', 3, '2026-10-01T00:00:00Z'\)/);
    expect(migration).toMatch(/round\(coalesce\(new\.cost_cents, 0\) \* 1000000 \/ v_taux\)::bigint/);
  });
});

describe('arrondis : toujours vers le BAS à l’affichage', () => {
  it('0,999999 crédit s’affiche 0 ; 1,999999 s’affiche 1', () => {
    expect(creditsAffiches(999_999)).toBe(0);
    expect(creditsAffiches(1_000_000)).toBe(1);
    expect(creditsAffiches(1_999_999)).toBe(1);
    expect(creditsAffiches(-5)).toBe(0);
  });
  it('restants arrondis vers le bas : jamais un crédit promis qui n’existe pas', () => {
    const e = etatDepuis({ inclus: true, totalCredits: 1000, utilisesMicro: 257_500_001, renouvellement_le: '2026-11-12', palier: 'normal' });
    expect(e).toMatchObject({ total: 1000, utilises: 257, restants: 742, pourcentage: 25, avertissement: null });
  });
});

describe('avertissements 80 % et 100 %', () => {
  const etat = (micro: number, palier: 'normal' | 'econome' | 'restreint' | 'epuise' = 'normal') =>
    etatDepuis({ inclus: true, totalCredits: 1000, utilisesMicro: micro, renouvellement_le: '2026-11-12', palier });
  it('79 % : rien ; 80 % : « 80 »', () => {
    expect(etat(799_999_999).avertissement).toBeNull();
    expect(etat(800_000_000).avertissement).toBe('80');
  });
  it('100 % : « 100 », 0 restant, palier épuisé', () => {
    expect(etat(1_000_000_000)).toMatchObject({ avertissement: '100', restants: 0, palier: 'epuise', pourcentage: 100 });
  });
  it('palier épuisé par la base (réservations en vol) : « 100 » même sous 100 %', () => {
    expect(etat(990_000_000, 'epuise').avertissement).toBe('100');
  });
  it('forfait sans Lumi : aucun avertissement', () => {
    expect(etatDepuis({ inclus: false, totalCredits: 0, utilisesMicro: 0, renouvellement_le: '2026-11-12', palier: 'normal' }).avertissement).toBeNull();
  });
});

describe('aucun montant en $ vers un client', () => {
  const route = lire('server/routes/lumi.ts');
  it('aucun événement de fin ne porte cost_cents ni budget', () => {
    const dones = route.match(/emettreSse\('done', \{[^\n]*/g) ?? [];
    expect(dones.length).toBeGreaterThan(10);
    for (const d of dones) {
      // Les CHAMPS envoyés ; « budget » passé en argument à etatCredits(...) reste interne.
      expect(d, d).not.toMatch(/cost_cents|budget:|, budget,/);
      expect(d, d).toMatch(/credits:/);
    }
  });
  it('/quota : des crédits ; le détail de coût seulement pour les comptes internes', () => {
    const bloc = route.slice(route.indexOf("router.get('/lumi/quota'"), route.indexOf("router.get('/lumi/credits'"));
    expect(bloc).not.toMatch(/\.\.\.budget/);
    expect(bloc).toMatch(/\.\.\.\(interne \? \{ cout:/);
  });
  it('conversation : tokens, sans coût', () => {
    const bloc = route.slice(route.indexOf("router.get('/lumi/conversations/:id'"));
    expect(bloc.slice(0, bloc.indexOf('\n});'))).not.toMatch(/cost_cents/);
  });
  it('l’événement « usage » du modèle ne porte plus de coût', () => {
    const orch = lire('server/lib/lumi/orchestrateur.ts');
    expect(orch).toMatch(/opts\.emettre\(\{ type: 'usage', model, usage: reponse\.usage \}\)/);
  });
  it('facturation (dont /billing/plans PUBLIC) : le plafond interne en ¢ est retiré', () => {
    const billing = lire('server/routes/billing.ts');
    expect(billing).toMatch(/return res\.json\(\{ plans: \(plans \|\| \[\]\)\.map\(sansCoutIa\) \}\)/);
    expect(billing).toMatch(/plans: sansCoutIa\(\(subRes\.data as any\)\.plans\)/);
    expect(billing).toMatch(/plans: sansCoutIa\(s\.plans \?\? null\)/);
  });
  it('« Construire avec Lumi » ne renvoie plus son coût', () => {
    expect(lire('server/routes/automation-rules.ts')).not.toMatch(/cout_cents/);
  });
  it('le message de pause parle en crédits, jamais en $', async () => {
    const { messagePause } = await import('../server/lib/lumi/budget');
    for (const langue of ['fr', 'en'] as const) expect(messagePause(langue, '2026-11-12')).not.toMatch(/\$|\d+\.\d\d/);
  });
});

describe('le bureau vient TOUJOURS de la session', () => {
  it('/credits et /credits/historique lisent auth.orgId, jamais un paramètre', () => {
    const route = lire('server/routes/lumi.ts');
    const bloc = route.slice(route.indexOf("router.get('/lumi/credits'"), route.indexOf('// ── Conversations'));
    expect(bloc).toMatch(/etatCredits\(getServiceClient\(\), auth\.orgId\)/);
    expect(bloc).not.toMatch(/req\.(query|body|params)\.(org|org_id|orgId)/);
    expect(bloc).toMatch(/hasPermission\(uctx, 'external_agent\.admin'\)/);
  });
});

describe('journal : idempotence par identifiant de réponse du fournisseur', () => {
  it('journaliserUsage fait un upsert « ignorer les doublons » sur (org_id, request_id)', async () => {
    const appels: Array<{ op: string; opts?: unknown; ligne: any }> = [];
    const admin = { from: () => ({
      upsert: async (ligne: any, opts: unknown) => { appels.push({ op: 'upsert', opts, ligne }); return { error: null }; },
      insert: async (ligne: any) => { appels.push({ op: 'insert', ligne }); return { error: null }; },
    }) } as never;
    const { journaliserUsage } = await import('../server/lib/lumi/budget');
    const base = { orgId: 'o', userId: 'u', conversationId: null, model: 'claude-sonnet-5', input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, cost_cents: 1 };
    await journaliserUsage(admin, { ...base, requestId: 'msg_1' });
    await journaliserUsage(admin, { ...base, requestId: 'msg_1' });
    await journaliserUsage(admin, { ...base });
    expect(appels[0]).toMatchObject({ op: 'upsert', opts: { onConflict: 'org_id,request_id', ignoreDuplicates: true }, ligne: { request_id: 'msg_1' } });
    expect(appels[1].op).toBe('upsert');
    expect(appels[2]).toMatchObject({ op: 'insert', ligne: { request_id: null } });
  });
  it('les appels payants passent l’id du fournisseur (chat, texto, construire, support, voix)', () => {
    expect(lire('server/lib/lumi/orchestrateur.ts')).toMatch(/opts\.journaliser\(reponse\.usage, model, cout, reponse\.id\)/);
    expect(lire('server/lib/sms/lumi-sms.ts')).toMatch(/requestId: requestId \?\? null/);
    expect(lire('server/lib/lumi/generer-parcours.ts')).toMatch(/requestId: rep\.id \?\? null/);
    expect(lire('server/lib/support/ia.ts')).toMatch(/requestId: reponse\.id \?\? null/);
    expect(lire('server/routes/agent.ts')).toMatch(/source: 'voix', requestId: r\.requestId \?\? null/);
  });
});

describe('outil Lumi get_lumi_credits : en crédits seulement', () => {
  it('ne renvoie aucun champ en $ ni en cents', async () => {
    vi.resetModules();
    vi.doMock('../server/lib/lumi/budget', async (orig) => ({
      ...(await orig<typeof import('../server/lib/lumi/budget')>()),
      etatCredits: async () => ({ inclus: true, total: 1000, utilises: 258, restants: 742, pourcentage: 25, renouvellement_le: '2026-11-12', palier: 'normal', avertissement: null }),
    }));
    vi.doMock('../server/lib/supabase', async (orig) => ({ ...(await orig<object>()), getServiceClient: () => ({}) }));
    const { OUTILS_REGLAGES } = await import('../server/lib/agent/tools-reglages');
    const outil = OUTILS_REGLAGES.find((o) => o.declaration.name === 'get_lumi_credits')!;
    const r = await outil.handler({}, { orgId: 'org-1' } as never) as Record<string, unknown>;
    expect(r).toMatchObject({ credits_restants: 742, credits_inclus: 1000, renouvellement_le: '2026-11-12' });
    expect(JSON.stringify(r)).not.toMatch(/cents|\$|dollar/i);
    expect(outil.declaration.description).toMatch(/never convert credits to dollars/);
  });
});
