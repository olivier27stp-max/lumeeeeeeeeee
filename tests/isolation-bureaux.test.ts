/**
 * ISOLATION STRICTE ENTRE BUREAUX — contrat figé, sans base de données.
 *
 * Décision produit (2026-09-24) : entre les bureaux d'une même compagnie, la SEULE
 * donnée partagée est le catalogue Produits & Services (predefined_services) —
 * plus les droits d'abonnement, qui vivent sur un bureau du groupe. Tout le
 * reste (clients, jobs, devis, factures, demandes, visites, tâches…) est cloisonné
 * par bureau, sans jamais retomber sur « le premier bureau du compte ».
 *
 * Ce que ces tests vérifient statiquement :
 *  1. le navigateur n'a plus AUCUN repli vers current_org_id() ni vers la première
 *     membership ; le bureau vient du sélecteur (CompanyContext → orgApi) ;
 *  2. chaque requête Supabase du navigateur porte l'en-tête x-org-id, et le
 *     wrapper fetch fait de même pour /api ;
 *  3. le serveur exige x-org-id pour un compte multi-bureaux (400 org_required)
 *     et refuse un bureau non membre (403) — plus de devinette ;
 *  4. companyOrgIds (élargissement au groupe) n'apparaît que dans les fichiers
 *     autorisés : catalogue, abonnement/facturation, gestion des bureaux ;
 *  5. la migration de défense en base existe et pose une policy RESTRICTIVE sur
 *     les tables métier, en excluant les tables du sélecteur et du catalogue ;
 *  6. les listes principales filtrent explicitement org_id (jamais « tout ce que
 *     la RLS laisse passer »).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const RACINE = resolve(__dirname, '..');
const lire = (p: string) => readFileSync(resolve(RACINE, p), 'utf8');

function fichiers(dir: string, ext: RegExp, acc: string[] = []): string[] {
  for (const nom of readdirSync(resolve(RACINE, dir))) {
    const rel = join(dir, nom);
    const abs = resolve(RACINE, rel);
    if (statSync(abs).isDirectory()) fichiers(rel, ext, acc);
    else if (ext.test(nom)) acc.push(rel);
  }
  return acc;
}

const SRC = fichiers('src', /\.(ts|tsx)$/).filter((f) => !/\.test\.tsx?$/.test(f) && !/mockData/.test(f));
const SERVEUR = fichiers('server', /\.ts$/).filter((f) => !/\.test\.ts$/.test(f));

describe('1. Source unique du bureau actif côté navigateur', () => {
  it('orgApi ne retombe plus sur current_org_id() et publie/abonne le bureau du contexte', () => {
    const s = lire('src/lib/orgApi.ts');
    expect(s).not.toMatch(/rpc\(\s*['"]current_org_id['"]/);
    expect(s).toMatch(/export function publierBureauActif/);
    expect(s).toMatch(/export function bureauActifSync/);
    expect(s).toMatch(/export function abonnerBureauActif/);
  });

  it('CompanyContext publie le bureau actif et coupe les canaux realtime à la bascule', () => {
    const s = lire('src/contexts/CompanyContext.tsx');
    expect(s).toMatch(/publierBureauActif\(activeOrgId\)/);
    expect(s).toMatch(/queryClient\.clear\(\)/);
    expect(s).toMatch(/supabase\.removeAllChannels\(\)/);
  });

  it("aucun fichier de src/ n'appelle rpc('current_org_id')", () => {
    const fautifs = SRC.filter((f) => /rpc\(\s*['"]current_org_id['"]/.test(lire(f)));
    expect(fautifs).toEqual([]);
  });

  it("aucun fichier de src/ ne devine le bureau via memberships … limit(1)", () => {
    // La première membership n'est PAS le bureau sélectionné. Seul CompanyContext lit
    // memberships (toutes, pour le sélecteur) ; les formulaires d'inscription créent la leur.
    const autorises = new Set(['src/contexts/CompanyContext.tsx', 'src/pages/OnboardingFlow.tsx']);
    const motif = /from\(\s*['"]memberships['"]\s*\)[\s\S]{0,300}?\.limit\(\s*1\s*\)/;
    const fautifs = SRC.filter((f) => !autorises.has(f) && motif.test(lire(f)));
    expect(fautifs).toEqual([]);
  });
});

describe('2. Chaque requête du navigateur porte x-org-id', () => {
  it('le client Supabase injecte x-lume-org depuis la source unique (bureauActifSync)', () => {
    const s = lire('src/lib/supabase.ts');
    expect(s).toMatch(/global:\s*\{\s*fetch:\s*fetchAvecBureauActif\s*\}/);
    expect(s).toMatch(/bureauActifSync\(\)/);
    expect(s).toMatch(/headers\.set\('x-lume-org', org\)/);
  });

  it('le wrapper fetch /api lit la même source', () => {
    const s = lire('src/lib/apiOrgHeader.ts');
    expect(s).toMatch(/bureauActifSync/);
    expect(lire('src/main.tsx')).toMatch(/apiOrgHeader/);
  });
});

describe('3. Le serveur ne devine plus le bureau', () => {
  const s = lire('server/lib/supabase.ts');
  it('400 org_required pour un compte multi-bureaux sans en-tête', () => {
    expect(s).toMatch(/code:\s*'org_required'/);
    expect(s).toMatch(/status\(400\)/);
  });
  it('403 org_forbidden quand l’en-tête vise un bureau non membre', () => {
    expect(s).toMatch(/code:\s*'org_forbidden'/);
  });
  it('le repli resolveOrgId reste réservé aux comptes à un seul bureau', () => {
    const idx = s.indexOf("code: 'org_required'");
    const apres = s.slice(idx);
    expect(apres).toMatch(/orgId = await resolveOrgId\(client\)/);
  });
});

describe('4. companyOrgIds (groupe) uniquement pour le catalogue et les droits', () => {
  const AUTORISES = new Set([
    'server/lib/supabase.ts',                       // définition
    'server/lib/subscription-guard.ts',             // paywall : le plan vit sur un bureau du groupe
    'server/lib/lumi/budget.ts',                    // budget IA du plan
    'server/lib/field-sales/commission-engine.ts',  // catégories de commission du catalogue
    'server/lib/agent/tools-reglages.ts',           // catalogue (Lumi)
    'server/lib/agent/tools-etendus.ts',            // catalogue (Lumi)
    'server/routes/billing.ts',                     // abonnement
    'server/routes/orgs.ts',                        // liste/quota/accès des bureaux
    'server/routes/invitations.ts',                 // sièges du plan
    'server/routes/creator-space-features.ts',      // plateforme (admins Lume seulement)
    'server/routes/creator-space-notes.ts',         // plateforme (admins Lume seulement)
    'server/routes/creator-space-billing.ts',       // plateforme : abonnement Stripe du workspace (admins Lume seulement)
  ]);
  it('aucun autre fichier serveur ne lit des données à l’échelle du groupe', () => {
    const fautifs = SERVEUR.filter((f) => !AUTORISES.has(f) && /companyOrgIds\(/.test(lire(f)));
    expect(fautifs).toEqual([]);
  });
  it('le leaderboard ne mélange les bureaux que sur demande explicite (scope=all)', () => {
    const s = lire('server/routes/leaderboard.ts');
    expect(s).toMatch(/=== 'all' \? 'all' : 'mine'/);
  });
});

describe('4b. Aucune lecture d’un autre bureau depuis le navigateur', () => {
  it("aucun .neq('org_id') dans src/ (la météo lisait les bureaux frères)", () => {
    const fautifs = SRC.filter((f) => /\.neq\(\s*['"]org_id['"]/.test(lire(f)));
    expect(fautifs).toEqual([]);
  });
  it(".in('org_id', …) réservé au catalogue partagé et aux noms de bureaux du sélecteur", () => {
    const autorises = new Set(['src/lib/servicesApi.ts', 'src/contexts/CompanyContext.tsx']);
    const fautifs = SRC.filter((f) => !autorises.has(f) && /\.in\(\s*['"]org_id['"]/.test(lire(f)));
    expect(fautifs).toEqual([]);
  });
  it('la route /payments/providers/status vérifie l’appartenance au bureau demandé', () => {
    const s = lire('server/routes/payments.ts');
    const i = s.indexOf("router.get('/payments/providers/status'");
    expect(i).toBeGreaterThan(0);
    expect(s.slice(i, i + 900)).toMatch(/isOrgMember\(auth\.client, auth\.user\.id, requestedOrgId\)/);
  });
});

describe('5. Défense en base : policy RESTRICTIVE « bureau_actif »', () => {
  const sql = lire('supabase/migrations/20260927120000_bureau_actif_via_en_tete.sql');
  it('lit l’en-tête x-org-id exposé par PostgREST, sans jamais lever d’erreur', () => {
    expect(sql).toMatch(/create or replace function public\.bureau_actif_demande\(\)/);
    expect(sql).toMatch(/request\.headers/);
    expect(sql).toMatch(/'x-lume-org'/);
    expect(sql).toMatch(/'x-org-id'/);
    expect(sql).toMatch(/exception when others then\s+return null/);
  });
  it('pose une policy restrictive sur chaque table métier portant org_id', () => {
    expect(sql).toMatch(/create policy bureau_actif on public\.%I as restrictive for all to authenticated/);
    expect(sql).toMatch(/column_name = 'org_id'/);
    expect(sql).toMatch(/table_type = 'BASE TABLE'/);
  });
  it('exclut les tables du sélecteur de bureau et le catalogue partagé', () => {
    for (const t of ['memberships', 'orgs', 'company_settings', 'subscriptions', 'predefined_services']) {
      expect(sql).toMatch(new RegExp(`'${t}'`));
    }
  });
  it('current_org_id() préfère l’en-tête quand le compte en est membre', () => {
    const corps = sql.slice(sql.indexOf('create or replace function public.current_org_id()'));
    const iEnTete = corps.indexOf('public.bureau_actif_demande()');
    const iRepli = corps.indexOf('order by m.created_at asc');
    expect(iEnTete).toBeGreaterThan(0);
    expect(iRepli).toBeGreaterThan(iEnTete);
  });
});

describe('6. Les listes principales filtrent explicitement le bureau', () => {
  const cas: Array<[string, RegExp]> = [
    ['src/lib/jobsApi.ts', /from\('jobs_active'\)\.select\([^)]*\)[^;]*\.eq\('org_id'/],
    ['src/lib/tasksApi.ts', /from\('tasks_active'\)\s*\.select\([^)]*\)\s*\.eq\('org_id'/],
    ['src/lib/pipelineApi.ts', /from\('pipeline_deals_visible'\)[\s\S]{0,1500}?\.eq\('org_id', orgId\)/],
    ['src/lib/emailTemplatesApi.ts', /from\('email_templates'\)\s*\.select\('\*'\)\s*\.eq\('org_id'/],
    ['src/lib/invoicesApi.ts', /from\('org_billing_settings'\)\.select\('\*'\)\.eq\('org_id'/],
    ['src/pages/RecurringJobs.tsx', /from\('job_recurrence_rules'\)[\s\S]{0,200}?\.eq\('org_id'/],
    ['src/lib/locationApi.ts', /return getCurrentOrgIdOrThrow\(\);/],
    ['src/lib/recurringJobsApi.ts', /org_id: await getCurrentOrgIdOrThrow\(\)/],
  ];
  for (const [f, re] of cas) {
    it(`${f} filtre org_id`, () => {
      expect(lire(f)).toMatch(re);
    });
  }
});
