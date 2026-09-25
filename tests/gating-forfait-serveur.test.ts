/**
 * Gating de forfait côté serveur.
 *
 * Le gating ne vivait que dans React : <PlanFeatureGate flag="…"> cache le
 * menu et la route, mais l'API répondait à qui l'appelait directement.
 * Constaté le 2026-09-25 : 0 vérification de forfait dans automation-rules,
 * automation-events, automation-test, reminders et reminders-cron.
 *
 * Le piège de ce genre de garde, c'est le préfixe qui ne couvre rien : elle
 * passe tous ses tests unitaires et ne protège aucune route réelle. Le premier
 * bloc croise donc les préfixes avec les chemins VRAIMENT déclarés dans les
 * routeurs — un renommage de route fait échouer le test.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  drapeauPourChemin,
  modeGardeFonction,
  verdictFonctionPourOrg,
  PREFIXES_PROTEGES,
} from '../server/lib/feature-guard';

const RACINE = resolve(__dirname, '..');

/** Chemins réellement déclarés par un routeur, préfixés de /api. */
function cheminsDeclares(fichier: string): string[] {
  const p = resolve(RACINE, 'server/routes', fichier);
  if (!existsSync(p)) return [];
  const src = readFileSync(p, 'utf8');
  const out: string[] = [];
  for (const m of src.matchAll(/router\.(?:get|post|put|patch|delete)\(\s*'([^']+)'/g)) {
    out.push(`/api${m[1]}`);
  }
  return out;
}

describe('les préfixes couvrent les routes qui existent vraiment', () => {
  const fichiers = ['automation-rules.ts', 'automation-events.ts', 'automation-test.ts', 'reminders.ts'];

  for (const f of fichiers) {
    it(`${f} est entièrement couvert`, () => {
      const chemins = cheminsDeclares(f);
      expect(chemins.length, `aucune route lue dans ${f} — le test ne prouverait rien`).toBeGreaterThan(0);
      const nus = chemins.filter((c) => drapeauPourChemin(c) === null);
      expect(nus, `routes sans gating dans ${f}`).toEqual([]);
    });
  }

  it('chaque préfixe déclaré protège au moins une route réelle', () => {
    // Un préfixe qui ne matche rien donne une garde qui rassure sans agir.
    const tous = fichiers.flatMap(cheminsDeclares);
    for (const { prefixe } of PREFIXES_PROTEGES) {
      expect(tous.some((c) => c.startsWith(prefixe)), `préfixe mort : ${prefixe}`).toBe(true);
    }
  });
});

describe('drapeauPourChemin', () => {
  it('réclame le forfait sur les automatisations et les relances', () => {
    expect(drapeauPourChemin('/api/automations/rules')).toBe('includes_automations');
    expect(drapeauPourChemin('/api/reminders/settings')).toBe('includes_automations');
  });

  it('laisse passer le reste du produit', () => {
    for (const c of ['/api/clients', '/api/invoices', '/api/billing/current', '/api/health', '/api/jobs/42']) {
      expect(drapeauPourChemin(c), c).toBeNull();
    }
  });

  it('ne bloque pas le cron : il n’a pas d’utilisateur', () => {
    // reminders-cron est monté sous /api/cron/, hors des préfixes protégés.
    expect(drapeauPourChemin('/api/cron/payment-reminders')).toBeNull();
  });

  it('ne se laisse pas avoir par un préfixe voisin', () => {
    expect(drapeauPourChemin('/api/automations-publiques')).toBeNull();
  });
});

describe('modeGardeFonction', () => {
  it('démarre en journalisation, pas en blocage', () => {
    // On veut VOIR qui serait coupé avant de couper.
    expect(modeGardeFonction({} as NodeJS.ProcessEnv)).toBe('log');
  });

  it('accepte enforce et off', () => {
    expect(modeGardeFonction({ FEATURE_GUARD: 'enforce' } as NodeJS.ProcessEnv)).toBe('enforce');
    expect(modeGardeFonction({ FEATURE_GUARD: 'off' } as NodeJS.ProcessEnv)).toBe('off');
  });

  it('une valeur illisible retombe sur log, jamais sur enforce', () => {
    // Une faute de frappe ne doit pas couper le service de tout le monde.
    for (const v of ['ENFORCER', 'oui', '', ' ', 'true']) {
      expect(modeGardeFonction({ FEATURE_GUARD: v } as NodeJS.ProcessEnv), v).toBe('log');
    }
  });

  it('ignore la casse et les espaces', () => {
    expect(modeGardeFonction({ FEATURE_GUARD: '  ENFORCE ' } as NodeJS.ProcessEnv)).toBe('enforce');
  });
});

/** Faux client Supabase : rend le plan demandé au bout de la chaîne. */
function faussClient(plan: Record<string, unknown> | null, erreur?: string) {
  const chaine: any = {
    select: () => chaine,
    in: () => chaine,
    order: () => chaine,
    limit: () => chaine,
    maybeSingle: async () =>
      erreur ? { data: null, error: { message: erreur } } : { data: plan ? { plans: plan } : null, error: null },
  };
  return { from: () => chaine, rpc: async () => ({ data: null, error: null }) } as any;
}

// companyOrgIds interroge la base ; on le court-circuite en passant un client
// dont tout appel retombe sur la chaîne ci-dessus.
const ORG = '00000000-0000-4000-8000-000000000001';

describe('verdictFonctionPourOrg', () => {
  it('Starter n’a pas les automatisations', async () => {
    const v = await verdictFonctionPourOrg(faussClient({ slug: 'starter', includes_automations: false }), ORG, 'includes_automations');
    expect(v.autorise).toBe(false);
    expect(v.raison).toBe('hors_forfait');
    expect(v.forfait).toBe('starter');
  });

  it('Scale et Autopilot les ont', async () => {
    for (const slug of ['pro', 'autopilot']) {
      const v = await verdictFonctionPourOrg(faussClient({ slug, includes_automations: true }), ORG, 'includes_automations');
      expect(v.autorise, slug).toBe(true);
      expect(v.raison, slug).toBe('inclus');
    }
  });

  it('sans abonnement lisible, il laisse passer — ce n’est pas son rôle', async () => {
    // C'est subscription-guard qui traite l'absence d'abonnement : lui seul
    // distingue essai, grâce et non-paiement. Répondre « hors forfait » ici
    // couperait un client en période de grâce.
    const v = await verdictFonctionPourOrg(faussClient(null), ORG, 'includes_automations');
    expect(v.autorise).toBe(true);
    expect(v.raison).toBe('forfait_inconnu');
  });

  it('colonne absente : il retombe sur la règle par slug, comme le front', async () => {
    const starter = await verdictFonctionPourOrg(faussClient({ slug: 'starter' }), ORG, 'includes_automations');
    expect(starter.autorise).toBe(false);
    const pro = await verdictFonctionPourOrg(faussClient({ slug: 'pro' }), ORG, 'includes_automations');
    expect(pro.autorise).toBe(true);
  });

  it('une lecture en panne lève, pour que l’appelant fail-open', async () => {
    await expect(
      verdictFonctionPourOrg(faussClient(null, 'timeout'), ORG, 'includes_automations'),
    ).rejects.toThrow(/plan lookup failed/);
  });
});
