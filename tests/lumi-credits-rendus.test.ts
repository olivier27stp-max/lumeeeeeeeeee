/**
 * Crédits Lumi rendus (2026-09-30) : un remboursement passe par
 * `lumi_credits_ajustements`, JAMAIS par `ai_usage` (grand livre en ajout seul
 * = le suivi de nos vrais coûts API). Les trois calculs de consommation —
 * affichage, dépense du mois, plafond dur — doivent tous le soustraire, sinon
 * l'écran et le blocage ne sont plus d'accord.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const DOSSIER = resolve(__dirname, '../supabase/migrations');
const MIGRATION = readFileSync(resolve(DOSSIER, '20261005500000_lumi_credits_rendus.sql'), 'utf8');

/** Dernière définition d'une fonction parmi toutes les migrations (ordre des noms de fichiers). */
function derniereDefinition(nom: string): string {
  let def = '';
  for (const f of readdirSync(DOSSIER).filter((x) => x.endsWith('.sql')).sort()) {
    const sql = readFileSync(resolve(DOSSIER, f), 'utf8');
    const re = new RegExp(`create or replace function public\\.${nom}\\(([\\s\\S]*?)(?=create or replace function|\\ncommit;|$)`, 'gi');
    for (const m of sql.matchAll(re)) def = m[0];
  }
  return def;
}

describe('crédits Lumi rendus', () => {
  it.each(['lumi_credits_utilises', 'lumi_depense_du_mois', 'reserve_ai_budget'])('%s soustrait les crédits rendus, sans passer sous zéro', (nom) => {
    const def = derniereDefinition(nom);
    expect(def).toMatch(/lumi_credits_ajustements|lumi_credits_rendus_micro/);
    expect(def).toMatch(/greatest\(0/);
  });

  it('le grand livre des coûts n’est jamais modifié par un remboursement', () => {
    expect(MIGRATION).not.toMatch(/(insert into|update|delete from)\s+public\.ai_usage\b/i);
  });

  it('la table est réservée au serveur', () => {
    expect(MIGRATION).toMatch(/enable row level security/);
    expect(MIGRATION).toMatch(/revoke all on public\.lumi_credits_ajustements from anon, authenticated/);
    expect(MIGRATION).toMatch(/revoke all on function public\.lumi_credits_rendus_micro\(uuid\) from public, anon, authenticated/);
  });
});
