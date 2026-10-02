/**
 * Garde du jeu « roles » — à lancer AVANT chaque passe Playwright du lot.
 *
 * Le harnais (tests/automations-suite/harnais/bureau-test.ts → assurerOrg) cherche le bureau par son nom
 * avec `.maybeSingle()` SANS regarder l'erreur : si la lecture échoue (base saturée, « statement timeout »),
 * il CRÉE un second bureau du même nom ; dès qu'il y en a deux, la lecture échoue toujours et chaque passe
 * en crée un de plus. Ce script :
 *   1. attend que la base réponde vite deux fois de suite ;
 *   2. met à la corbeille tout doublon de « A (roles) » / « B (roles) » (adhésions retirées, abonnement factice
 *      annulé, règles coupées) — les deux bureaux d'origine sont gardés ;
 *   3. sort en erreur s'il ne reste pas exactement UN bureau A et UN bureau B.
 *
 *   cd D:/lume-uiaudit/wt && node --env-file=.env.local ../outils/roles/garde-bureaux.mjs
 */
import { createRequire } from 'node:module';
const require = createRequire('D:/lume-uiaudit/wt/package.json');
const { createClient } = require('@supabase/supabase-js');

const url = process.env.VITE_SUPABASE_URL ?? '';
if (!url || url.includes('bbzcuzqfgsdvjsymfwmr')) throw new Error('REFUS : staging seulement.');
const a = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY ?? '', { auth: { persistSession: false, autoRefreshToken: false } });

const GARDER = { A: '766cd6ac-9524-43bc-bfcc-f015a08a3ab4', B: '5a9c075f-e0ce-4bc9-9e69-cf5362e5b69b' };
const NOM = (l) => `[TEST] QA Automatisations ${l} (roles) — ne pas utiliser`;

async function essayer(quoi, f, essais = 12) {
  let derniere = '';
  for (let i = 0; i < essais; i++) {
    const r = await f();
    if (!r.error) return r;
    derniere = r.error.message;
    await new Promise((ok) => setTimeout(ok, 2500));
  }
  throw new Error(`${quoi} : ${derniere}`);
}

// 1. La base répond-elle vite, deux fois de suite ?
let rapides = 0;
for (let i = 0; i < 60 && rapides < 2; i++) {
  const t = Date.now();
  const r = await a.from('orgs').select('id').eq('id', GARDER.A).maybeSingle();
  const ms = Date.now() - t;
  if (!r.error && r.data && ms < 3000) rapides += 1; else { rapides = 0; console.log(`[garde] base lente ou en erreur (${ms} ms, ${r.error?.message ?? 'ok'}) — nouvelle tentative`); await new Promise((ok) => setTimeout(ok, 4000)); }
}
if (rapides < 2) { console.error('[garde] ARRÊT : la base de staging ne répond pas correctement.'); process.exit(2); }

// 2. Doublons.
for (const l of ['A', 'B']) {
  const { data } = await essayer('lecture des bureaux', () => a.from('orgs').select('id, name, created_at').eq('name', NOM(l)).is('deleted_at', null).order('created_at'));
  for (const o of data) {
    if (o.id === GARDER[l]) continue;
    await essayer('adhésions', () => a.from('memberships').delete().eq('org_id', o.id).select('user_id'));
    await essayer('abonnement', () => a.from('subscriptions').update({ status: 'canceled' }).eq('org_id', o.id).select('id'));
    await essayer('règles', () => a.from('automation_rules').update({ is_active: false }).eq('org_id', o.id).select('id'));
    await essayer('bureau', () => a.from('orgs').update({ deleted_at: new Date().toISOString(), name: `[TEST] doublon du banc (roles) ${o.id.slice(0, 8)} — supprimé` }).eq('id', o.id).select('id'));
    console.log(`[garde] doublon ${o.id} (${o.created_at}) mis à la corbeille.`);
  }
}
// Adhésions restées dans un doublon déjà renommé.
{
  const { data } = await essayer('doublons renommés', () => a.from('orgs').select('id').like('name', '[TEST] doublon du banc (roles)%'));
  for (const o of data) await essayer('adhésions', () => a.from('memberships').delete().eq('org_id', o.id).select('user_id'));
}

// 3. Exactement un A et un B, tous deux en bac à sable.
for (const l of ['A', 'B']) {
  const { data } = await essayer('vérification', () => a.from('orgs').select('id').eq('name', NOM(l)).is('deleted_at', null));
  if (data.length !== 1 || data[0].id !== GARDER[l]) { console.error(`[garde] ARRÊT : ${data.length} bureau(x) « ${NOM(l)} ».`); process.exit(3); }
}
const { data: bac } = await essayer('bac à sable', () => a.from('orgs_envois_simules').select('org_id').in('org_id', [GARDER.A, GARDER.B]));
if (bac.length !== 2) { console.error('[garde] ARRÊT : un bureau du jeu n’est pas en bac à sable.'); process.exit(4); }
console.log('[garde] jeu « roles » sain : un bureau A, un bureau B, en bac à sable ; base réactive.');
