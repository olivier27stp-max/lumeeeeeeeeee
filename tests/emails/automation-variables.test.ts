/**
 * Cohérence contenu ↔ code des automatisations.
 *
 * Les tests précédents vérifiaient que les messages PARTENT. Ceux-ci
 * vérifient qu'ils DISENT quelque chose : les variables citées dans les textes
 * doivent réellement être fournies par le résolveur pour l'entité concernée.
 *
 * La panne trouvée : `resolveEntityVariables` n'avait aucune branche `quote`,
 * alors que `quote.sent` et `quote.approved` émettent `entityType: 'quote'`.
 * Mesuré en prod : 322 règles actives sur 46 orgs, ZÉRO exécution. Toute la
 * séquence de relance de soumission et de rappel de dépôt était morte —
 * silencieusement, puisque `resolveTemplate` remplace une variable inconnue
 * par une chaîne vide au lieu de laisser le placeholder visible.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveTemplate, resolveEntityVariables } from '../../server/lib/actions/index';

const root = resolve(__dirname, '..', '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

/** Faux client Supabase : renvoie une ligne par table interrogée. */
function fakeSupabase(rows: Record<string, any>) {
  const chain = (table: string): any => {
    const c: any = {
      select: () => c,
      eq: () => c,
      maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
    };
    return c;
  };
  return { from: (t: string) => chain(t) } as any;
}

describe('resolveTemplate — une variable absente laisse un trou, pas un placeholder', () => {
  it('remplace les deux syntaxes [var] et {var}', () => {
    const vars = { client_first_name: 'Marie', company_name: 'Coquin Lavage' };
    expect(resolveTemplate('Bonjour [client_first_name], ici [company_name]', vars))
      .toBe('Bonjour Marie, ici Coquin Lavage');
    expect(resolveTemplate('Bonjour {client_first_name}', vars)).toBe('Bonjour Marie');
  });

  it('une variable inconnue devient une chaîne vide — d’où l’invisibilité du bug', () => {
    // C'est précisément ce qui rendait la panne `quote` indétectable côté
    // journaux : le client recevait « Bonjour , » sans qu'aucune erreur ne soit
    // levée.
    expect(resolveTemplate('Bonjour [client_first_name],', {})).toBe('Bonjour ,');
  });
});

describe('résolveur — la branche `quote` existe enfin', () => {
  const actions = read('server/lib/actions/index.ts');

  it('le code gère entityType === "quote"', () => {
    expect(actions).toContain("if (entityType === 'quote')");
    expect(actions).toContain("from('quotes')");
  });

  it('les variables client d’une soumission sont résolues', async () => {
    const supa = fakeSupabase({
      company_settings: { company_name: 'Coquin Lavage', phone: '555', google_review_url: '' },
      quotes: {
        quote_number: 'Q-1042', total_cents: 125000, currency: 'CAD',
        valid_until: '2026-09-01', client_id: 'c1', lead_id: null, job_id: null,
      },
      clients: { first_name: 'Marie', last_name: 'Tremblay', email: 'marie@ex.ca', phone: '+15550001', company: null },
    });

    const vars = await resolveEntityVariables(supa, 'org1', 'quote', 'q1');
    expect(vars.client_first_name).toBe('Marie');
    expect(vars.client_email).toBe('marie@ex.ca');
    expect(vars.client_phone).toBe('+15550001');
    expect(vars.company_name).toBe('Coquin Lavage');
    expect(vars.quote_number).toBe('Q-1042');
  });

  it('un message de relance de soumission ne contient plus de trou', async () => {
    const supa = fakeSupabase({
      company_settings: { company_name: 'Coquin Lavage', phone: '', google_review_url: '' },
      quotes: { quote_number: 'Q-9', total_cents: 5000, currency: 'CAD', client_id: 'c1', lead_id: null, job_id: null },
      clients: { first_name: 'Marie', last_name: 'T', email: 'm@ex.ca', phone: '+1', company: null },
    });
    const vars = await resolveEntityVariables(supa, 'org1', 'quote', 'q1');
    // Texte réel du preset quote_followup_1d.
    const msg = resolveTemplate('Bonjour [client_first_name], suivi de [company_name].', vars);
    expect(msg).toBe('Bonjour Marie, suivi de Coquin Lavage.');
    expect(msg).not.toContain(', suivi de .');
  });

  it('un devis encore au stade prospect résout via lead_id', async () => {
    // `quotes` porte deux liens vers `clients` : sans ce repli, une soumission
    // envoyée à un prospect ne résolvait rien.
    const supa = fakeSupabase({
      company_settings: { company_name: 'X', phone: '', google_review_url: '' },
      quotes: { quote_number: 'Q-2', total_cents: 0, client_id: null, lead_id: 'l1', job_id: null },
      clients: { first_name: 'Alex', last_name: 'P', email: 'a@ex.ca', phone: '+2', company: null },
    });
    const vars = await resolveEntityVariables(supa, 'org1', 'quote', 'q1');
    expect(vars.client_first_name).toBe('Alex');
    expect(vars.client_email).toBe('a@ex.ca');
  });

  it('la lecture est cloisonnée par organisation', () => {
    const bloc = actions.slice(
      actions.indexOf("if (entityType === 'quote')"),
      actions.indexOf("if (entityType === 'job')"),
    );
    expect(bloc).toContain("eq('org_id', orgId)");
  });
});

describe('repli sur le nom d’entreprise quand le prénom est vide', () => {
  it('une fiche entreprise ne produit plus « Bonjour , »', async () => {
    // `clients.first_name` est nullable et vide sur une fiche d'entreprise.
    const supa = fakeSupabase({
      company_settings: { company_name: 'Lume', phone: '', google_review_url: '' },
      clients: { first_name: null, last_name: null, email: 'contact@acme.ca', phone: '+1', company: 'Acme Inc.' },
    });
    const vars = await resolveEntityVariables(supa, 'org1', 'client', 'c1');
    expect(vars.client_first_name).toBe('Acme Inc.');
    expect(vars.client_name).toBe('Acme Inc.');
    expect(resolveTemplate('Bonjour [client_first_name],', vars)).toBe('Bonjour Acme Inc.,');
  });

  it('le prénom reste prioritaire quand il existe', async () => {
    const supa = fakeSupabase({
      company_settings: { company_name: 'Lume', phone: '', google_review_url: '' },
      clients: { first_name: 'Marie', last_name: 'T', email: 'm@ex.ca', phone: '+1', company: 'Acme Inc.' },
    });
    const vars = await resolveEntityVariables(supa, 'org1', 'client', 'c1');
    expect(vars.client_first_name).toBe('Marie');
    expect(vars.client_name).toBe('Marie T');
  });

  it('le helper est partagé par toutes les branches', () => {
    const actions = read('server/lib/actions/index.ts');
    expect(actions).toContain('const setClientVars =');
    // 1 définition + 5 usages (lead, client, quote, job, invoice, appointment —
    // la branche rendez-vous partage l'appel avec son repli `client_name`).
    expect((actions.match(/setClientVars\(/g) || []).length).toBeGreaterThanOrEqual(6);
    // L'assignation n'existe plus qu'à UN endroit : le helper lui-même.
    // (La branche rendez-vous garde un repli distinct sur `jobs.client_name`,
    // quand aucune fiche client n'est jointe.)
    expect((actions.match(/vars\.client_last_name =/g) || []).length).toBe(1);
  });
});

describe('détails de contenu', () => {
  const actions = read('server/lib/actions/index.ts');

  it('l’adresse par défaut « - » n’est pas affichée au client', () => {
    // `jobs.property_address` a pour DEFAULT '-' : le client recevait
    // littéralement « Adresse : - ».
    expect(actions).toContain("adresse === '-' ? '' : adresse");
  });

  it('les modèles d’avis acceptent la même syntaxe que les presets', () => {
    // Ce bloc avait son propre résolveur, limité à {var}. Un modèle écrit avec
    // [var] — la syntaxe de tous les presets — affichait le placeholder brut
    // au client.
    expect(actions).toContain('subject = resolveTemplate(emailTemplate.subject, templateVars)');
    expect(actions).toContain('body = resolveTemplate(emailTemplate.body, templateVars)');
    expect(actions).toContain('...vars,');
  });

  it('tous les presets utilisent la syntaxe [var], supportée par le résolveur', () => {
    const presets = read('server/lib/automationPresets.data.ts');
    // Aucune syntaxe {{var}} (non gérée) ne doit apparaître dans les textes.
    expect(presets).not.toMatch(/\{\{\w+\}\}/);
  });
});
