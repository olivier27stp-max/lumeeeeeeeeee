/**
 * CATALOGUE PARTAGÉ ENTRE LES BUREAUX D'UNE COMPAGNIE.
 *
 * Décision produit (2026-09-09) : les Produits & Services sont communs à tous
 * les bureaux (orgs d'un même company_group_id). Tout le reste — clients,
 * jobs, factures — reste séparé par bureau.
 *
 * Ces tests figent le contrat, sans base de données :
 *  1. la RLS de predefined_services s'évalue sur la COMPAGNIE, via une brique
 *     dédiée dont authenticated détient bien l'EXECUTE (la brique historique
 *     same_company_orgs a été révoquée pour ce rôle — une policy qui l'utiliserait
 *     casserait silencieusement) ;
 *  2. le navigateur filtre toujours explicitement par les bureaux de la
 *     compagnie ACTIVE — jamais « tout ce que la RLS laisse passer », sinon une
 *     personne membre de deux compagnies verrait leurs catalogues mélangés ;
 *  3. la création reste rattachée au bureau actif (org_id = bureau créateur) ;
 *  4. les lectures serveur du catalogue (agent, commissions) couvrent la
 *     compagnie et non le seul bureau, sinon un service d'un bureau frère
 *     « disparaît » de l'agent et perd sa catégorie de commission.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RACINE = resolve(__dirname, '..');
const lire = (p: string) => readFileSync(resolve(RACINE, p), 'utf8');

const SQL = lire('supabase/migrations/20260910000000_catalogue_partage_bureaux.sql');
const API = lire('src/lib/servicesApi.ts');
const AGENT = lire('server/lib/agent/tools-etendus.ts');
const COMMISSIONS = lire('server/lib/field-sales/commission-engine.ts');

describe('RLS predefined_services — périmètre compagnie', () => {
  it('remplace les quatre policies par-bureau par des policies par-compagnie', () => {
    for (const op of ['select', 'insert', 'update', 'delete']) {
      expect(SQL).toMatch(new RegExp(`drop policy if exists predefined_services_${op}_org`));
      expect(SQL).toMatch(new RegExp(`create policy predefined_services_${op}_company on public\\.predefined_services`));
    }
  });

  it('chaque policy passe par has_company_membership, jamais par same_company_orgs (EXECUTE révoqué)', () => {
    const policies = SQL.split('create policy').slice(1);
    expect(policies.length).toBe(4);
    for (const p of policies) {
      expect(p).toContain('public.has_company_membership((select auth.uid()), org_id)');
      expect(p).not.toContain('same_company_orgs');
    }
  });

  it('la brique et la RPC sont exécutables par authenticated et fermées à anon/public', () => {
    for (const fn of ['has_company_membership(uuid, uuid)', 'company_org_ids(uuid)']) {
      expect(SQL).toContain(`revoke all on function public.${fn} from public, anon;`);
      expect(SQL).toContain(`grant execute on function public.${fn} to authenticated;`);
    }
  });

  it('la brique exige un membership ACTIF et borne au même company_group_id', () => {
    const brique = SQL.slice(SQL.indexOf('function public.has_company_membership'), SQL.indexOf('function public.company_org_ids'));
    expect(brique).toContain("m.status = 'active'");
    expect(brique).toContain('o1.company_group_id = o2.company_group_id');
    expect(brique).toContain('o1.company_group_id is not null');
  });

  it('la RPC company_org_ids ne renvoie rien à qui n’est pas de la compagnie', () => {
    const rpc = SQL.slice(SQL.indexOf('function public.company_org_ids'), SQL.indexOf('-- ── 3.'));
    expect(rpc).toContain('public.has_company_membership(auth.uid(), p_org)');
  });
});

describe('servicesApi — le navigateur filtre par la compagnie active', () => {
  it('lit le catalogue sur les bureaux frères de l’org active (rpc company_org_ids + .in)', () => {
    expect(API).toContain("supabase.rpc('company_org_ids', { p_org: orgId })");
    const list = API.slice(API.indexOf('export async function listPredefinedServices'), API.indexOf('export async function createPredefinedService'));
    expect(list).toContain('getCompanyOrgIds(orgId)');
    expect(list).toContain(".in('org_id', orgIds)");
    expect(list).not.toContain(".eq('org_id'");
  });

  it('retombe sur l’org active seule si la RPC échoue (migration pas posée)', () => {
    const helper = API.slice(API.indexOf('export function getCompanyOrgIds'), API.indexOf('export async function listPredefinedServices'));
    expect(helper).toContain('return [orgId];');
    expect(helper).toContain('companyOrgIdsCache.delete(orgId)');
  });

  it('la création reste rattachée au bureau actif', () => {
    const create = API.slice(API.indexOf('export async function createPredefinedService'), API.indexOf('export async function updatePredefinedService'));
    expect(create).toContain('const orgId = await getCurrentOrgIdOrThrow();');
    expect(create).toContain('org_id: orgId,');
  });
});

describe('lectures serveur du catalogue — compagnie, pas bureau', () => {
  it('l’agent list_services couvre les bureaux frères de l’office actif', () => {
    const outil = AGENT.slice(AGENT.indexOf('const listServices: AgentTool'), AGENT.indexOf('};', AGENT.indexOf('const listServices: AgentTool')));
    expect(outil).toContain('companyOrgIds(getServiceClient(), ctx.orgId)');
    expect(outil).toContain(".in('org_id', orgIds)");
    expect(outil).not.toContain(".eq('org_id', ctx.orgId)");
  });

  it('le moteur de commissions retrouve la catégorie d’un service d’un bureau frère', () => {
    const i = COMMISSIONS.indexOf(".from('predefined_services')");
    const bloc = COMMISSIONS.slice(i, i + 200);
    expect(bloc).toContain('companyOrgIds(supabase, orgId)');
    expect(bloc).not.toContain(".eq('org_id', orgId)");
  });
});
