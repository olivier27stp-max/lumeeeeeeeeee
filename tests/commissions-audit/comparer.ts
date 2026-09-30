/**
 * Compare l'oracle (oracle.sql) aux entrées réellement écrites par le moteur.
 * Utilisé par les tests d'exactitude et en ligne de commande :
 *   npx tsx tests/commissions-audit/comparer.ts
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import { DB_URL, exigerLocal } from './env-local';
import { ORG, FACTURES, HISTORIQUE_TAUX } from './fixture';

const ICI = path.dirname(fileURLToPath(import.meta.url));

export interface Attendu { org_id: string; invoice_id: string; user_id: string; montant_cents: number; base_cents: number; mois: string; etat: 'active' | 'reprise' }
export interface Reel { id: string; org_id: string; invoice_id: string | null; job_id: string | null; user_id: string; montant_cents: number; base_cents: number; status: string; triggered_at: string; created_at: string }

export async function lireOracle(db: pg.Client, orgs: string[] = [ORG.A, ORG.B]): Promise<Attendu[]> {
  const sql = readFileSync(path.join(ICI, 'oracle.sql'), 'utf8');
  const { rows } = await db.query(sql, [orgs, JSON.stringify(HISTORIQUE_TAUX)]);
  return rows.map((r) => ({ ...r, montant_cents: Number(r.montant_cents), base_cents: Number(r.base_cents) }));
}

export async function lireReel(db: pg.Client, orgs: string[] = [ORG.A, ORG.B]): Promise<Reel[]> {
  const { rows } = await db.query(
    `select id, org_id, invoice_id, job_id, user_id, round(amount*100)::bigint montant_cents, round(coalesce(base_amount,0)*100)::bigint base_cents,
            status, triggered_at, created_at
       from fs_commission_entries where org_id = any($1::uuid[]) and deleted_at is null`, [orgs]);
  return rows.map((r) => ({ ...r, montant_cents: Number(r.montant_cents), base_cents: Number(r.base_cents) }));
}

export const cleFacture = (invoiceId: string | null) => FACTURES.find((x) => x.id === invoiceId)?.cle ?? (invoiceId ? invoiceId.slice(-4) : '—');

export interface Ecart { cle: string; user_id: string; attendu: number | null; reel: number | null; etat_attendu: string | null; statut_reel: string | null }

/** Écarts entre l'oracle et le moteur, par (facture, bénéficiaire). */
export function ecarts(attendus: Attendu[], reels: Reel[]): Ecart[] {
  const confirmes = reels.filter((r) => r.invoice_id);
  const cles = new Set([...attendus.map((a) => `${a.invoice_id}|${a.user_id}`), ...confirmes.map((r) => `${r.invoice_id}|${r.user_id}`)]);
  const out: Ecart[] = [];
  for (const k of cles) {
    const [inv, user] = k.split('|');
    const a = attendus.find((x) => x.invoice_id === inv && x.user_id === user) ?? null;
    const r = confirmes.find((x) => x.invoice_id === inv && x.user_id === user) ?? null;
    const etatReel = r ? (r.status === 'reversed' ? 'reprise' : 'active') : null;
    if (!a || !r || a.montant_cents !== r.montant_cents || a.etat !== etatReel) {
      out.push({ cle: cleFacture(inv), user_id: user, attendu: a?.montant_cents ?? null, reel: r?.montant_cents ?? null, etat_attendu: a?.etat ?? null, statut_reel: r?.status ?? null });
    }
  }
  return out.sort((x, y) => x.cle.localeCompare(y.cle));
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('tests/commissions-audit/comparer.ts')) {
  exigerLocal();
  const db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  const [a, r] = [await lireOracle(db), await lireReel(db)];
  const e = ecarts(a, r);
  console.log(`oracle: ${a.length} lignes · moteur: ${r.filter((x) => x.invoice_id).length} confirmées + ${r.filter((x) => !x.invoice_id).length} estimations`);
  console.table(e.map((x) => ({ facture: x.cle, rep: x.user_id.slice(-3), attendu: x.attendu, moteur: x.reel, diff: (x.reel ?? 0) - (x.attendu ?? 0), etat_attendu: x.etat_attendu, statut_moteur: x.statut_reel })));
  await db.end();
}
