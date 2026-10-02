/**
 * Agent E — point 8 de la mission : ce que le MOTEUR remplit vraiment, par déclencheur.
 *
 * Le vrai `resolveEntityVariables` sur de vraies fiches de mon bureau A (pile locale).
 * Relevé complet : scripts/qa/finale/e/releve-variables-par-entite.mts →
 * D:/lume-final/sorties/e/variables-par-entite.json.
 *
 *   QA_AUTO_SUFFIXE=e npx vitest run --maxWorkers=2 --config tests/automations-finale/e/vitest.config.ts --project e-integration tests/automations-finale/e/integration/e-variables-moteur.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { demarrerMoteur, marque } from '../../../automations-suite/harnais/moteur';
import { resolveEntityVariables, resolveTemplate } from '../../../../server/lib/actions/index';
import { PILE_LOCALE, Menage, creerClient, champParCle, ecrireChamp, type Bureau } from './outils-e';

let b: Awaited<ReturnType<typeof demarrerMoteur>>;
const menage = new Menage();
const m = marque('E-VAR');
let client = ''; let facture = ''; let job = ''; let visite = '';

beforeAll(async () => {
  if (!PILE_LOCALE) return;
  process.env.PUBLIC_URL ||= 'http://127.0.0.1:5495';
  b = await demarrerMoteur();
  client = await creerClient(b, menage, m, { first_name: 'Zoé', phone: '+15145550170' });
  const refere = await champParCle(b as Bureau, 'client', 'refere_par');
  await ecrireChamp(b as Bureau, 'client', client, refere!.id, 'Facebook');
  const inserer = async (table: string, ligne: Record<string, unknown>) => {
    const { data, error } = await b.admin.from(table).insert({ org_id: b.orgA, created_by: b.users.proprioA, ...ligne }).select('id').single();
    if (error) throw new Error(`${table} : ${error.message}`);
    menage.ajouter(() => b.admin.from(table).delete().eq('id', (data as { id: string }).id));
    return (data as { id: string }).id;
  };
  facture = await inserer('invoices', {
    invoice_number: `EV-${Date.now().toString(36)}`, client_id: client, status: 'partial',
    subtotal_cents: 45000, tax_cents: 6739, total_cents: 51739, paid_cents: 20000, balance_cents: 31739,
    due_date: new Date(Date.now() - 37 * 86400_000).toISOString().slice(0, 10),
  });
  job = await inserer('jobs', { job_number: `EV-${Date.now().toString(36)}`, title: 'Lavage de vitres', client_id: client, client_name: 'Zoé', property_address: '120 rue Principale, Montréal', status: 'scheduled' });
  const debut = new Date(Date.now() + 3 * 86400_000);
  visite = await inserer('schedule_events', { job_id: job, title: 'Lavage de vitres', start_at: debut.toISOString(), end_at: new Date(debut.getTime() + 7200_000).toISOString(), status: 'scheduled' });
});
afterAll(async () => { await menage.vider(); });

describe.skipIf(!PILE_LOCALE)('E — variables remplies par le moteur', () => {
  it('[E-38 témoin] sur une FACTURE : numéro, total, échéance, lien, prénom, et les champs de la fiche ({{client.first_name}}, {{client.refere_par}}, {{invoice.due_date}})', async () => {
    const vars = await resolveEntityVariables(b.admin, b.orgA, 'invoice', facture);
    const rendu = resolveTemplate('[client_first_name]|[invoice_number]|[invoice_total]|[invoice_link]|{{client.first_name}}|{{client.refere_par}}|{{invoice.due_date}}', vars);
    const morceaux = rendu.split('|');
    expect(morceaux[0]).toBe('Zoé');
    expect(morceaux[2]).toMatch(/517,39/);
    expect(morceaux[3]).toMatch(/\/invoice\//);
    expect(morceaux.slice(4, 6)).toEqual(['Zoé', 'Facebook']);
    expect(morceaux[6]).not.toBe('');
    expect(morceaux.every((x) => x !== '')).toBe(true);
  });

  it('[E-37] sur un RENDEZ-VOUS : les champs de la fiche que l’éditeur propose ({{client.first_name}}, {{client.refere_par}}, {{job.title}}) sont remplis — aujourd’hui les 100 sont VIDES', async () => {
    const vars = await resolveEntityVariables(b.admin, b.orgA, 'schedule_event', visite);
    // Témoin : les variables classiques du rendez-vous, elles, sont remplies.
    expect(vars.client_first_name).toBe('Zoé');
    expect(vars.appointment_date).not.toBe('');
    const rendu = resolveTemplate('{{client.first_name}}|{{client.refere_par}}|{{job.title}}', vars);
    expect(rendu, 'aujourd’hui : « || » — le texto part « Bonjour , »').toBe('Zoé|Facebook|Lavage de vitres');
  });

  it('[E-39] facture payée en partie et en retard : une variable porte le SOLDE DÛ (317,39 $), une autre les JOURS DE RETARD (37)', async () => {
    const vars = await resolveEntityVariables(b.admin, b.orgA, 'invoice', facture);
    const valeurs = Object.values(vars).map(String);
    const solde = valeurs.some((v) => /317,39/.test(v));
    const retard = valeurs.some((v) => v.trim() === '37');
    expect({ solde, retard }, `aujourd’hui : seul le TOTAL existe ([invoice_total] = ${vars.invoice_total})`).toEqual({ solde: true, retard: true });
  });

  it('[E-39] le courriel de l’ENTREPRISE est une variable (le nom et le téléphone le sont déjà)', async () => {
    const vars = await resolveEntityVariables(b.admin, b.orgA, 'client', client);
    expect(vars.company_name).toBe('Nettoyage Test A'); // témoin
    expect(vars.company_phone).not.toBe('');             // témoin
    expect(Object.values(vars)).toContain('bureau-a@lume-qa.test');
  });
});
