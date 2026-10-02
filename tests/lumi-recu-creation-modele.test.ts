/**
 * Créer une automatisation depuis un MODÈLE (ou par copie) : le reçu dit ce
 * qu'elle CONTIENT, relu en base (`server/lib/lumi/execution.ts`).
 *
 * Avant : « Automatisation créée en brouillon à partir du modèle. » — sans un
 * mot sur ses étapes. « Crée un rappel par texto la veille du rendez-vous »
 * créait, par le modèle « Rappel de rendez-vous — la veille », un texto ET un
 * courriel que personne n'avait demandé, et Lumi ne le disait pas
 * (tests/automations-suite/integration/40-iklm-lumi-demandes, I-002).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { etat } = vi.hoisted(() => ({ etat: { resultat: {} as Record<string, any>, regle: null as Record<string, any> | null, lectures: 0 } }));

vi.mock('../server/lib/agent/garde', () => ({ executerOutilGarde: async () => ({ result: etat.resultat }) }));
vi.mock('../server/lib/lumi/fiches', () => ({ ficheCreee: async () => null }));
vi.mock('../server/lib/logger', () => ({ logger: { info: () => {}, warn: () => {}, error: () => {} } }));
vi.mock('../server/lib/agent/registre', () => ({ ECRITURES_SENSIBLES: new Set<string>(), JAMAIS_D_OFFICE: new Set<string>() }));

import { executerEcriture } from '../server/lib/lumi/execution';
import { avecContexteLumi, nouveauContexteLumi } from '../server/lib/lumi/contexte-appel';

const client = {
  from: () => {
    const q: any = {};
    for (const m of ['select', 'eq', 'is']) q[m] = () => q;
    q.maybeSingle = async () => { etat.lectures += 1; return { data: etat.regle, error: null }; };
    return q;
  },
} as any;

const ID = '11111111-2222-4333-8444-555555555555';
const regle = () => ({
  id: ID, name: 'Rappel de rendez-vous — la veille', trigger_event: 'appointment.created', conditions: {}, settings: null,
  steps: null, delay_seconds: -86400, is_active: false, is_preset: false, deleted_at: null,
  actions: [
    { type: 'send_sms', config: { body: 'Rappel : votre rendez-vous avec [company_name] est demain à [appointment_time].' } },
    { type: 'send_email', config: { subject: 'Votre rendez-vous est demain', body: '<p>Bonjour [client_first_name],</p><p>Votre rendez-vous est demain.</p>' } },
    { type: 'log_activity', config: {} },
  ],
});
const executer = (tool: string) => executerEcriture({ tool, toolUseId: 't1', args: { template_key: 'job_reminder_1d' }, userId: 'u', orgId: 'org', client });

beforeEach(() => { etat.regle = regle(); etat.lectures = 0; etat.resultat = { created: true, rule_id: ID, name: 'Rappel de rendez-vous — la veille', is_active: false, note: 'Créée EN BROUILLON à partir du modèle.' }; });

describe('le reçu d’une automatisation créée depuis un modèle dit ce qu’elle contient', () => {
  it('le texto ET le courriel du modèle sont dits, avec le déclencheur en clair et l’état « en brouillon »', async () => {
    const { contenu, recu } = await executer('create_automation_from_template');
    expect(recu.ok).toBe(true);
    const r = JSON.parse(contenu).result;
    expect(r.recu).toMatch(/Créée en brouillon : rien ne part tant qu’elle n’est pas activée/);
    expect(r.recu).toContain('Déclencheur : Rendez-vous planifié');
    expect(r.recu).toMatch(/Texto/);
    expect(r.recu).toMatch(/Courriel/);
    expect(r.recu).toContain('« Rappel : votre rendez-vous avec [company_name] est demain à [appointment_time]. »');
    // Le moment (« la veille ») est dit : la règle est au format d'origine, délai négatif.
    expect(r.recu).toMatch(/1 jour/);
    expect(r.recu).not.toMatch(/appointment\.created|send_sms|send_email|log_activity/);
  });

  it('en anglais dans une conversation en anglais', async () => {
    const { contenu } = await avecContexteLumi(nouveauContexteLumi('c1', 'en'), () => executer('create_automation_from_template'));
    const r = JSON.parse(contenu).result;
    expect(r.recu).toMatch(/Created as a draft/);
    expect(r.recu).toMatch(/Email/);
  });

  it('pareil pour une copie (`duplicate_automation_rule`)', async () => {
    const { contenu } = await executer('duplicate_automation_rule');
    expect(JSON.parse(contenu).result.recu).toMatch(/Ce qu’elle fait/);
  });

  it('rien n’est ajouté ni relu pour un autre outil, un résultat incertain, ou sans identifiant', async () => {
    await executer('create_client');
    expect(etat.lectures).toBe(0);
    etat.resultat = { incertain: true, rule_id: ID };
    expect(JSON.parse((await executer('create_automation_from_template')).contenu).result.recu).toBeUndefined();
    etat.resultat = { created: true, rule_id: null };
    expect(JSON.parse((await executer('create_automation_from_template')).contenu).result.recu).toBeUndefined();
    expect(etat.lectures).toBe(0);
  });

  it('un reçu déjà écrit par l’outil n’est pas remplacé ; une règle illisible ne casse pas l’exécution', async () => {
    etat.resultat = { created: true, rule_id: ID, recu: 'Reçu de l’outil.' };
    expect(JSON.parse((await executer('create_automation_from_template')).contenu).result.recu).toBe('Reçu de l’outil.');
    etat.resultat = { created: true, rule_id: ID };
    etat.regle = null;
    const { contenu, recu } = await executer('create_automation_from_template');
    expect(recu.ok).toBe(true);
    expect(JSON.parse(contenu).result.recu).toBeUndefined();
  });
});
