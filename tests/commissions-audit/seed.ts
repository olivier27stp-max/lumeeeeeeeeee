/**
 * Rejoue le tenant de test (fixture.ts) dans la base LOCALE, à travers les
 * vraies fonctions du moteur de commissions.
 *
 *   npx tsx tests/commissions-audit/seed.ts          (TZ=UTC imposé : comme Railway)
 *
 * Idempotent : efface d'abord tout ce qui appartient aux orgs cc…a1-a4.
 * Chaque entrée de commission reçoit ensuite created_at = heure simulée de
 * l'événement qui l'a créée (le moteur écrit now() ; en prod, now() EST
 * l'heure de l'événement).
 */
import pg from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { API, DB_URL, SERVICE_KEY, brancherServeurSurLocal } from './env-local';
import {
  ORG, TZ, MEMBRES, MOT_DE_PASSE, REGLES, FACTURES, LIGNE_DU_TEMPS, JOB_ESTIMATION_SEULE, DEVIS_Q1,
  U, f, ordonner, taxesQc, id, type FactureFixture,
} from './fixture';

type Moteur = typeof import('../../server/lib/field-sales/commission-engine');

const ORGS = Object.values(ORG);
const NOMS_ORG: Record<string, string> = {
  [ORG.A]: 'Fixture A — Commissions', [ORG.B]: 'Fixture B — Autre tenant', [ORG.C]: 'Fixture C — Vide', [ORG.V]: 'Fixture V — Volume',
};

export async function nettoyer(db: pg.Client) {
  await db.query('begin');
  await db.query(`set local session_replication_role = replica`);
  const { rows } = await db.query<{ t: string }>(`
    select format('%I.%I', c.table_schema, c.table_name) t from information_schema.columns c
    join information_schema.tables tb on tb.table_schema=c.table_schema and tb.table_name=c.table_name and tb.table_type='BASE TABLE'
    where c.table_schema='public' and c.column_name='org_id'`);
  for (const r of rows) await db.query(`delete from ${r.t} where org_id = any($1::uuid[])`, [ORGS]);
  await db.query(`delete from public.orgs where id = any($1::uuid[])`, [ORGS]);
  await db.query(`delete from public.profiles where id::text like 'cc000000-%'`);
  await db.query(`delete from auth.identities where user_id::text like 'cc000000-%'`);
  await db.query(`delete from auth.users where id::text like 'cc000000-%'`);
  await db.query('commit');
}

async function ok<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, quoi: string): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(`${quoi}: ${error.message}`);
  return data;
}

async function socle(sc: SupabaseClient) {
  const { data: plans } = await sc.from('plans').select('id, includes_d2d').order('includes_d2d', { ascending: false });
  const planId = plans?.[0]?.id;
  for (const m of MEMBRES) {
    const { error } = await sc.auth.admin.createUser({
      id: m.id, email: m.courriel, password: MOT_DE_PASSE, email_confirm: true,
      user_metadata: { full_name: `${m.prenom} ${m.nom}` },
    } as never);
    if (error) throw new Error(`utilisateur ${m.courriel}: ${error.message}`);
    await ok(sc.from('profiles').upsert({ id: m.id, full_name: `${m.prenom} ${m.nom}` }), 'profil');
  }
  for (const org of ORGS) {
    const proprio = MEMBRES.find((m) => m.org === org && m.role === 'owner')!;
    await ok(sc.from('orgs').insert({ id: org, name: NOMS_ORG[org], created_by: proprio.id }), 'org');
    await ok(sc.from('company_settings').upsert({ org_id: org, company_name: NOMS_ORG[org], timezone: TZ }, { onConflict: 'org_id' }), 'company_settings');
    await ok(sc.from('payroll_settings').upsert({ org_id: org, pay_period_type: 'monthly', timezone: TZ }, { onConflict: 'org_id' }), 'payroll_settings');
    await ok(sc.from('commission_settings').upsert({ org_id: org, reversal_policy: org === ORG.A ? 'auto' : 'alert', default_rule_id: null }, { onConflict: 'org_id' }), 'commission_settings');
    if (planId) await ok(sc.from('subscriptions').insert({ user_id: proprio.id, org_id: org, plan_id: planId, status: 'active' }), 'abonnement');
    await ok(sc.from('clients').insert({ id: clientDe(org), org_id: org, first_name: 'Client', last_name: NOMS_ORG[org], created_by: proprio.id }), 'client');
  }
  for (const m of MEMBRES) {
    await ok(sc.from('memberships').upsert({ user_id: m.id, org_id: m.org, role: m.role, status: 'active', full_name: `${m.prenom} ${m.nom}` }, { onConflict: 'user_id,org_id' }), 'membership');
    await ok(sc.from('team_members').update({
      email: m.courriel, first_name: m.prenom, last_name: m.nom, role: m.role, status: 'active',
      compensation_mode: m.mode, ...(m.taux_horaire_cents != null ? { hourly_rate_cents: m.taux_horaire_cents } : {}),
    }).eq('org_id', m.org).eq('user_id', m.id), 'team_member');
    const { count } = await sc.from('team_members').select('id', { count: 'exact', head: true }).eq('org_id', m.org).eq('user_id', m.id);
    if (count !== 1) throw new Error(`team_member absent pour ${m.courriel}`);
  }
  for (const r of REGLES) {
    const { org, ...rest } = r as typeof r & { org: string };
    await ok(sc.from('fs_commission_rules').insert({ ...rest, org_id: org, type: 'percentage', is_active: true, priority: 0 }), 'règle');
  }
}

export const clientDe = (org: string) => id(0xc00 + ORGS.indexOf(org));
const proprioDe = (org: string) => MEMBRES.find((m) => m.org === org && m.role === 'owner')!.id;

async function creerJob(sc: SupabaseClient, x: { id: string; org: string; rep: string; sous_total_cents: number; rabais_cents?: number; cree_le: string; titre: string; numero: string }) {
  const base = x.sous_total_cents - (x.rabais_cents ?? 0);
  const tax = taxesQc(base);
  await ok(sc.from('jobs').insert({
    id: x.id, org_id: x.org, title: x.titre, job_number: x.numero, client_id: clientDe(x.org),
    salesperson_id: x.rep, created_by: proprioDe(x.org), status: 'scheduled',
    subtotal_cents: x.sous_total_cents, tax_cents: tax, total_cents: base + tax, created_at: x.cree_le,
  }), `job ${x.titre}`);
}

async function envoyerFacture(sc: SupabaseClient, x: FactureFixture, rang: number) {
  const base = x.sous_total_cents - (x.rabais_cents ?? 0);
  await ok(sc.from('invoices').insert({
    id: x.id, org_id: x.org, client_id: clientDe(x.org), job_id: x.job, created_by: proprioDe(x.org),
    invoice_number: `FX-${x.cle}-${String(rang).padStart(3, '0')}`, subject: x.note,
    tax_cents: taxesQc(base), discount_cents: x.rabais_cents ?? 0, status: 'draft', created_at: x.cree_le,
  }), `facture ${x.cle}`);
  await ok(sc.from('invoice_items').insert({
    org_id: x.org, invoice_id: x.id, description: `Service ${x.cle}`, qty: 1, unit_price_cents: x.sous_total_cents, line_total_cents: x.sous_total_cents,
  }), `ligne ${x.cle}`);
  await ok(sc.from('invoices').update({ issued_at: x.cree_le }).eq('id', x.id), `émission ${x.cle}`);
}

export async function seed() {
  brancherServeurSurLocal();
  process.env.TZ = 'UTC';
  const moteur: Moteur = await import('../../server/lib/field-sales/commission-engine');
  const sc = createClient(API, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  try {
    await nettoyer(db);
    await socle(sc);


    const journal: string[] = [];
    const avant = async () => new Set((await db.query<{ id: string }>(`select id from fs_commission_entries where org_id = any($1::uuid[])`, [ORGS])).rows.map((r) => r.id));
    let rang = 0;

    for (const e of ordonner(LIGNE_DU_TEMPS)) {
      const deja = await avant();
      let res: unknown = null;
      switch (e.type) {
        case 'job': {
          const x = f(e.cle);
          await creerJob(sc, { id: x.job!, org: x.org, rep: x.rep!, sous_total_cents: x.sous_total_cents, rabais_cents: x.rabais_cents, cree_le: x.cree_le, titre: `Job ${x.cle}`, numero: `FXJ-${x.cle}` });
          if (x.cle === 'Q1') await ok(sc.from('quotes').insert({
            id: DEVIS_Q1.id, org_id: ORG.A, quote_number: 'FX-Q1', client_id: clientDe(ORG.A), job_id: f('Q1').job,
            salesperson_id: DEVIS_Q1.salesperson, created_by: U.adam, status: 'approved',
    }), 'devis Q1');
          res = await moteur.projectCommissionForJob(sc, x.org, x.job!);
          break;
        }
        case 'job_estimation_seule': {
          const j = JOB_ESTIMATION_SEULE;
          await creerJob(sc, { id: j.id, org: ORG.A, rep: j.rep, sous_total_cents: j.sous_total_cents, cree_le: j.cree_le, titre: 'Job estimation seule', numero: 'FXJ-E1' });
          res = await moteur.projectCommissionForJob(sc, ORG.A, j.id);
          break;
        }
        case 'facture_envoyee':
          await envoyerFacture(sc, f(e.cle), ++rang);
          break;
        case 'paiement': {
          const x = f(e.cle);
          const { data: facture } = await sc.from('invoices').select('total_cents, paid_cents').eq('id', x.id).single();
          const montant = e.cents ?? (facture!.total_cents - facture!.paid_cents);
          await ok(sc.from('payments').insert({
            org_id: x.org, invoice_id: x.id, job_id: x.job, client_id: clientDe(x.org), created_by: proprioDe(x.org),
            amount_cents: montant, status: 'succeeded', provider: 'manual', method: 'card', payment_date: e.t, paid_at: e.t,
          }), `paiement ${x.cle}`);
          // Ce que font le bouton « Marquer payée », le webhook Stripe et Lumi.
          res = await moteur.generateCommissionsForInvoice(sc, x.org, x.id);
          break;
        }
        case 'remboursement_total': {
          const x = f(e.cle);
          const { data: p } = await sc.from('payments').select('id, amount_cents').eq('invoice_id', x.id).eq('status', 'succeeded').single();
          await ok(sc.from('payments').update({ refunded_cents: p!.amount_cents, status: 'refunded' }).eq('id', p!.id), 'remboursement');
          // Exactement ce que fait POST /payments/refund quand isFullRefund.
          res = await moteur.handleInvoiceReversal(sc, x.org, x.id, 'Refund: fixture');
          break;
        }
        case 'void':
          await ok(sc.from('invoices').update({ status: 'void' }).eq('id', f(e.cle).id), 'void');
          break;
        case 'supprimer':
          await ok(sc.from('invoices').update({ deleted_at: e.t }).eq('id', f(e.cle).id), 'suppression');
          break;
        case 'taux':
          await ok(sc.from('fs_commission_rules').update({ base_percent: e.pourcent }).eq('id', e.regle), 'taux');
          break;
        case 'verser': {
          for (const cle of e.cles) {
            const { data: lignes } = await sc.from('fs_commission_entries').select('id, status').eq('invoice_id', f(cle).id);
            for (const l of lignes ?? []) {
              if (l.status === 'pending') await moteur.approveCommission(sc, f(cle).org, l.id, U.olivia);
              await moteur.markCommissionPaid(sc, f(cle).org, l.id);
              await db.query(`update fs_commission_entries set paid_at = $2, approved_at = coalesce(approved_at, $2) where id = $1`, [l.id, e.t]);
            }
          }
          break;
        }
        case 'paie_payee': {
          const { rows } = await db.query<{ c: string }>(
            `select coalesce(round(sum(amount)*100),0) c from fs_commission_entries where org_id=$1 and user_id=$2 and status='paid' and deleted_at is null`, [ORG.A, e.user]);
          await ok(sc.from('payroll_payments').insert({
            org_id: ORG.A, user_id: e.user, period_start: e.debut, period_end: e.fin, hours: 0, gross_cents: 0,
            commission_cents: Number(rows[0].c), adjustments_cents: 0, total_cents: Number(rows[0].c), paid_at: e.t, paid_by: U.olivia,
          }), 'paie payée');
          break;
        }
        case 'desactiver':
          await ok(sc.from('team_members').update({ status: 'inactive' }).eq('user_id', e.user), 'désactivation');
          break;
      }
      // Horloge simulée : les entrées nées de cet événement datent de l'événement.
      const nouvelles = [...await avant()].filter((x) => !deja.has(x));
      if (nouvelles.length) {
        await db.query(`update fs_commission_entries set created_at = $2,
            triggered_at = case when invoice_id is null then $2::timestamptz else triggered_at end where id = any($1::uuid[])`, [nouvelles, e.t]);
      }
      journal.push(`${e.t}  ${e.type.padEnd(20)} ${'cle' in e ? e.cle : ''} ${res ? JSON.stringify(res) : ''}`);
    }
    return journal;
  } finally {
    await db.end();
  }
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('tests/commissions-audit/seed.ts')) {
  seed().then((j) => { console.log(j.join('\n')); console.log('\n✓ tenant de test rejoué'); })
    .catch((err) => { console.error(err); process.exit(1); });
}
