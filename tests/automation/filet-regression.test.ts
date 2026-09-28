/**
 * FILET DE RÉGRESSION des automatisations — déclencheur × action, séquences
 * et presets.
 *
 * Pour chaque déclencheur du catalogue et chaque action compatible, deux
 * règles : immédiate (délai 0) et différée (1 jour). Plus une séquence
 * « action → attendre 1 jour → action » par déclencheur, et les 35 presets.
 * Chaque cas est rejoué par `filet-regression/_banc.ts` et sa sortie complète
 * (écritures en base, SMS, courriels, appels sortants, planifications,
 * annulations) est comparée à l'instantané `filet-regression/instantanes/`.
 *
 * L'instantané décrit le comportement ACTUEL, bugs compris — il ne juge rien.
 * Une PR dont le drapeau est OFF doit le laisser IDENTIQUE. Si un changement
 * est voulu, régénérer SCIEMMENT et relire le diff dans le commit :
 *     FILET_MAJ=1 npx vitest run tests/automation/filet-regression.test.ts
 */
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const etat = vi.hoisted(() => ({
  e: { sms: [] as any[], courriels: [] as any[], appels: [] as any[], slack: [] as any[] },
  client: { current: null as any },
}));

vi.mock('../../server/lib/supabase', async (orig) => ({
  ...(await orig<any>()),
  getServiceClient: () => etat.client.current,
}));
vi.mock('../../server/lib/mailer', async (orig) => ({
  ...(await orig<any>()),
  isMailerConfigured: () => true,
  sendEmail: vi.fn(async (p: any) => { etat.e.courriels.push({ to: p.to, subject: p.subject, html: p.html, headers: p.headers }); return { sent: true, messageId: 'filet' }; }),
}));
vi.mock('../../server/lib/twilioProvisioning', async (orig) => ({
  ...(await orig<any>()),
  getOrgSmsFromNumber: async () => '+15550000000',
}));
vi.mock('../../server/lib/slack', async (orig) => ({
  ...(await orig<any>()),
  isSlackConfigured: () => true,
  canalSupport: () => 'C_FILET',
  envoyerMessageSlack: vi.fn(async (canal: unknown, texte: unknown) => { etat.e.slack.push({ canal, texte }); return { ok: true, ts: '1.0' }; }),
}));

import { DECLENCHEURS, actionsPour, configParDefaut } from '../../src/lib/automationCatalogue';
import { AUTOMATION_PRESETS } from '../../server/lib/automationPresets.data';
import { jouer, evenementPour, courant, IDS, etatApres, resoluPendantAttente, type Regle } from './filet-regression/_banc';

const DOSSIER = join(__dirname, 'filet-regression', 'instantanes');
const MAJ = process.env.FILET_MAJ === '1';
const TZ_ORIGINE = process.env.TZ;

/** Les champs obligatoires sans valeur par défaut : une valeur plausible. */
const COMPLEMENTS: Record<string, Record<string, unknown>> = {
  ajouter_etiquette: { etiquette: 'vip' },
  retirer_etiquette: { etiquette: 'vip' },
  modifier_client: { statut: 'active', source: 'salon' },
  assigner_responsable: { membre_id: IDS.owner },
  modifier_statut_rendezvous: { statut: 'completed' },
  move_deal_stage: { stage_id: IDS.etape2 },
  modifier_deal: { source: 'salon' },
  assigner_deal: { membre_id: IDS.owner },
  webhook: { url: 'https://hooks.example.test/lume' },
  demarrer_automatisation: { rule_id: IDS.autreRegle },
  arreter_automatisation: { portee: 'courante' },
  update_custom_field: { field_id: IDS.champ, value: '2027-01-01' },
};

const configPour = (cle: string) => ({ ...configParDefaut(cle, true), ...(COMPLEMENTS[cle] ?? {}) });

interface Cas { nom: string; regle: Regle & { id: string }; declencheur: string; pendant?: Record<string, unknown> }

function casPourDeclencheur(cle: string): Cas[] {
  const cas: Cas[] = [];
  for (const a of actionsPour(cle)) {
    for (const delai of [0, 86400]) {
      cas.push({ nom: `${a.cle}@${delai}`, declencheur: cle, regle: { id: `regle-${cle}-${a.cle}-${delai}`, trigger_event: cle, delay_seconds: delai, actions: [{ type: a.cle, config: configPour(a.cle) }] } });
    }
  }
  // L'entité est « résolue » pendant l'attente (devis accepté, facture
  // payée, rendez-vous annulé, opportunité déplacée) : la relance part-elle ?
  const resolu = resoluPendantAttente(cle);
  if (resolu) {
    for (const a of ['send_sms', 'send_email', 'create_task']) {
      cas.push({ nom: `${a}@86400+resolu`, declencheur: cle, pendant: resolu, regle: { id: `regle-${cle}-${a}-resolu`, trigger_event: cle, delay_seconds: 86400, actions: [{ type: a, config: configPour(a) }] } });
    }
  }
  cas.push({
    nom: 'sequence:notification>attendre>sms', declencheur: cle,
    regle: {
      id: `regle-${cle}-sequence`, trigger_event: cle, delay_seconds: 0, actions: [],
      steps: [
        // `suivant` explicite : c'est ce que le builder enregistre, et le
        // moteur n'enchaîne QUE par lui (pas par l'ordre du tableau).
        { id: 'e1', type: 'action', action: { type: 'create_notification', config: { ...configPour('create_notification'), body: 'Suivi du parcours' } }, suivant: 'e2' },
        { id: 'e2', type: 'attendre', delai_secondes: 86400, suivant: 'e3' },
        { id: 'e3', type: 'action', action: { type: 'send_sms', config: configPour('send_sms') } },
      ],
    },
  });
  return cas;
}

function comparer(fichier: string, sorties: Record<string, unknown>) {
  const chemin = join(DOSSIER, fichier);
  if (MAJ) {
    mkdirSync(DOSSIER, { recursive: true });
    writeFileSync(chemin, JSON.stringify(sorties, null, 1) + '\n');
  }
  expect(existsSync(chemin), `instantané absent : ${chemin} — le générer avec FILET_MAJ=1`).toBe(true);
  const attendu = JSON.parse(readFileSync(chemin, 'utf8'));
  // Cas par cas : le message d'échec nomme le couple qui a bougé.
  expect(Object.keys(sorties).sort()).toEqual(Object.keys(attendu).sort());
  for (const k of Object.keys(attendu)) expect(sorties[k], `${fichier} › ${k}`).toEqual(attendu[k]);
}

beforeAll(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
    etat.e.appels.push({ url: String(url), corps: String(init?.body ?? '') });
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }));
  process.env.PUBLIC_URL = 'https://app.lume.test';
  process.env.FRONTEND_URL = 'https://app.lume.test';
});

afterEach(() => {
  vi.useRealTimers();
  if (TZ_ORIGINE === undefined) delete process.env.TZ; else process.env.TZ = TZ_ORIGINE;
});

/** Le banc écrit dans `courant.client` ; le mock de getServiceClient lit `etat.client`. */
const lier = () => Object.defineProperty(etat.client, 'current', { get: () => courant.client, configurable: true });

describe('filet de régression — déclencheur × action (délai 0 et 1 jour) + séquence', () => {
  for (const d of DECLENCHEURS) {
    it(d.cle, async () => {
      lier();
      const sorties: Record<string, unknown> = {};
      for (const c of casPourDeclencheur(d.cle)) {
        sorties[c.nom] = await jouer(c.regle, evenementPour(c.declencheur), etat.e, etatApres(c.declencheur), c.pendant ?? {});
      }
      comparer(`${d.cle}.json`, sorties);
    }, 120_000);
  }
});

describe('filet de régression — presets', () => {
  it('les 35 presets', async () => {
    lier();
    const sorties: Record<string, unknown> = {};
    for (const p of AUTOMATION_PRESETS) {
      let ev;
      try { ev = evenementPour(p.trigger_event); } catch { sorties[p.preset_key] = `déclencheur sans événement de test : ${p.trigger_event}`; continue; }
      sorties[p.preset_key] = await jouer(
        { id: `preset-${p.preset_key}`, name: p.name, preset_key: p.preset_key, trigger_event: p.trigger_event, conditions: p.conditions, delay_seconds: p.delay_seconds, actions: p.actions as any },
        { ...ev, metadata: { ...ev.metadata, ...(p.trigger_event === 'invoice.paid' && p.preset_key === 'deposit_received' ? { payment_type: 'deposit' } : {}) } },
        etat.e,
        etatApres(p.trigger_event),
      );
    }
    comparer('presets.json', sorties);
  }, 120_000);
});
