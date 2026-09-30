/**
 * Mesure de performance AVANT / APRÈS sur le tenant volumineux (org V).
 *   avant = code d'origine (localhost:3013), après = code corrigé (localhost:3012)
 *   npx tsx tests/commissions-audit/perf.mts
 * Pour chaque appel : médiane de 5, taille de la réponse, et le total renvoyé
 * comparé à la somme SQL exacte (gagné, hors reprises et estimations, bornes
 * du mois dans le fuseau de l'entreprise).
 */
import pg from 'pg';
import { API, ANON_KEY, DB_URL, exigerLocal } from './env-local';
import { ORG } from './fixture';

exigerLocal();
const SERVEURS = { avant: 'http://localhost:3013', apres: 'http://localhost:3012' };
const CAS = [
  { nom: 'liste du mois (page)', chemin: '/commissions?from=2026-09-01&to=2026-09-30' },
  { nom: 'totaux du mois (page)', chemin: '/commissions/payroll-preview?from=2026-09-01&to=2026-09-30' },
  { nom: 'changement de filtre : année 2025', chemin: '/commissions/payroll-preview?from=2025-01-01&to=2025-12-31' },
  { nom: 'liste sans filtre (profil, rapport)', chemin: '/commissions' },
  { nom: 'paie de la période', chemin: '/payroll/period-summary?ref=2026-09-15' },
];

const r0 = await fetch(`${API}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'vic@fixture-v.test', password: 'Fixture1234!' }),
});
const jeton = (await r0.json()).access_token as string;

const db = new pg.Client({ connectionString: DB_URL });
await db.connect();
const verite = async (from: string, to: string) => Number((await db.query(`
  select coalesce(sum(round(amount*100)),0) c from fs_commission_entries
   where org_id=$1 and deleted_at is null and invoice_id is not null and status <> 'reversed'
     and triggered_at >= ($2::date::timestamp at time zone 'America/Toronto')
     and triggered_at <  (($3::date + 1)::timestamp at time zone 'America/Toronto')`, [ORG.V, from, to])).rows[0].c);
const VERITE: Record<string, number> = {
  '2026-09': await verite('2026-09-01', '2026-09-30'),
  '2025': await verite('2025-01-01', '2025-12-31'),
};

function totalRenvoye(chemin: string, json: any): number | null {
  if (chemin.startsWith('/commissions/payroll-preview')) return json.totals_cents?.du_cents ?? Math.round(Number(json.total) * 100);
  if (chemin.startsWith('/payroll/period-summary')) return (json.rows ?? []).reduce((s: number, r: any) => s + (r.commission_cents ?? 0), 0);
  return null;
}

const lignes: string[] = ['| Appel | Code | Médiane (ms) | Taille | Lignes | Total renvoyé | Total exact | Juste ? |', '|---|---|---:|---:|---:|---:|---:|---|'];
for (const cas of CAS) {
  for (const [code, base] of Object.entries(SERVEURS)) {
    const temps: number[] = [];
    let json: any = null; let taille = 0; let statut = 0;
    for (let i = 0; i < 6; i++) {
      const t0 = performance.now();
      const r = await fetch(`${base}/api${cas.chemin}`, { headers: { Authorization: `Bearer ${jeton}`, 'x-org-id': ORG.V } });
      const texte = await r.text();
      if (i > 0) temps.push(performance.now() - t0); // 1er appel = échauffement
      statut = r.status; taille = texte.length;
      try { json = JSON.parse(texte); } catch { json = null; }
    }
    temps.sort((a, b) => a - b);
    const total = statut === 200 ? totalRenvoye(cas.chemin, json) : null;
    const exact = cas.chemin.includes('2025-01-01') ? VERITE['2025'] : cas.chemin.includes('2026-09') ? VERITE['2026-09'] : null;
    const nb = Array.isArray(json) ? json.length : Array.isArray(json?.rows) ? json.rows.length : '';
    lignes.push(`| ${cas.nom} | ${code} | ${statut === 200 ? Math.round(temps[2]) : `HTTP ${statut}`} | ${(taille / 1024).toFixed(0)} Ko | ${nb} | ${total ?? '—'} | ${exact ?? '—'} | ${total == null || exact == null ? '—' : total === exact ? 'oui' : `NON (${total - exact})`} |`);
  }
}
console.log(lignes.join('\n'));
await db.end();
