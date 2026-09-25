// L'entreprise (company_groups) — MULTI_BUREAUX_PLAN.md étape 5.
// Preuve en conditions réelles : e2e PostgREST staging 11/11 (inscription,
// 2e bureau, groupe explicite de script QA, lecture/renommage/suspension).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sql = readFileSync(resolve(__dirname, '..', 'supabase/migrations/20260927210000_company_groups_entreprise.sql'), 'utf8');

describe('company_groups', () => {
  it('tout bureau appartient à une entreprise existante (FK + NOT NULL)', () => {
    expect(sql).toMatch(/alter column company_group_id set not null/);
    expect(sql).toMatch(/foreign key \(company_group_id\) references public\.company_groups\(id\)/);
  });
  it('le trigger de création crée la ligne d’entreprise si elle manque', () => {
    const fn = sql.slice(sql.indexOf('create or replace function public.assign_org_company_group'));
    expect(fn).toMatch(/insert into public\.company_groups \(id, name\)[\s\S]*on conflict \(id\) do nothing/);
  });
  it('RLS forcée : lecture = membre actif, renommage = propriétaire, aucune création côté client', () => {
    expect(sql).toMatch(/force row level security/);
    expect(sql).toMatch(/has_org_membership\(\(select auth\.uid\(\)\), o\.id\)/);
    expect(sql).toMatch(/has_org_role\(\(select auth\.uid\(\)\), o\.id, array\['owner'\]\)/);
    expect(sql).toMatch(/revoke all on public\.company_groups from anon, authenticated/);
    expect(sql).toMatch(/grant update \(name\) on public\.company_groups to authenticated/);
    expect(sql).not.toMatch(/grant insert[^;]*company_groups[^;]*authenticated/);
  });
});
