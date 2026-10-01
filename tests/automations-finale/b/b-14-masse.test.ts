/**
 * Point 14 — 300 factures tombent en retard la même nuit : débit réel, pertes,
 * effet sur le reste. MESURE sur la pile locale (une fois, 300 événements).
 *
 *  A. Texto immédiat sur « Facture en retard » : combien partent dans la
 *     première minute (l'étalement promet 30 par minute) ? En combien de temps
 *     part le 300e, au rythme réel du tick de 5 minutes ?
 *  B. Courriel immédiat : débit de pointe (aucun étalement), échecs, et
 *     latence d'une lecture ordinaire de l'app pendant la rafale.
 *
 * « 5 minutes plus tard » est simulé en vieillissant les lignes de NOTRE
 * bureau (journaux et échéances reculés de 5 min), puis en appelant le vrai
 * `viderFile` — la boucle du tick du serveur.
 *
 * Sortie : D:/lume-final/sorties/b/b-14-masse.json
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { marque } from '../../automations-suite/harnais/moteur';
import { preparerBureau, ok, type Bureau } from '../../automations-suite/integration/10-b-outils';
import { regle, courriel, texto, jourLocal } from './outils-b';

let b: Bureau & { fuseau: string };
const mesures: Record<string, any> = {};
const N = 300;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterAll(() => {
  mkdirSync('D:/lume-final/sorties/b', { recursive: true });
  writeFileSync('D:/lume-final/sorties/b/b-14-masse.json', JSON.stringify(mesures, null, 2));
});

/** N clients (numéros fictifs AAA-555-01NN, tous différents) et N factures échues d'hier, en deux insertions. */
async function semer(m: string, n: number): Promise<string[]> {
  const maintenant = new Date().toISOString();
  const clients = await ok<Array<{ id: string }>>(b.admin.from('clients').insert(
    Array.from({ length: n }, (_, i) => ({
      org_id: b.orgA, created_by: b.users.proprioA, first_name: 'Masse', last_name: `${m} ${i}`, status: 'active',
      email: `masse-${Date.now().toString(36)}-${i}@lume-qa.test`,
      phone: `+1${200 + Math.floor(i / 100)}55501${String(i % 100).padStart(2, '0')}`,
      sms_consent_at: maintenant, email_consent_at: maintenant,
    })),
  ).select('id'), 'clients');
  const hier = jourLocal(b.fuseau, -1);
  const factures = await ok<Array<{ id: string }>>(b.admin.from('invoices').insert(
    clients.map((c, i) => ({
      org_id: b.orgA, client_id: c.id, created_by: b.users.proprioA,
      invoice_number: `B14-${Date.now().toString(36)}-${i}`,
      subtotal_cents: 20_000, tax_cents: 0, total_cents: 20_000, paid_cents: 0, balance_cents: 20_000,
      issued_at: new Date(Date.now() - 20 * 86_400_000).toISOString(), status: 'sent', due_date: hier, subject: `Facture ${m}`,
    })),
  ).select('id'), 'factures');
  return factures.map((f) => f.id);
}

async function envoisDe(m: string) {
  const lignes: Array<{ canal: string; created_at: string; destinataire: string }> = [];
  for (let de = 0; ; de += 1000) {
    const page = await ok<Array<{ canal: string; created_at: string; destinataire: string }>>(b.admin.from('envois_simules')
      .select('canal, created_at, destinataire').eq('org_id', b.orgA).like('corps', `%${m}%`).order('created_at').range(de, de + 999), 'envois');
    lignes.push(...page);
    if (page.length < 1000) break;
  }
  // Seulement NOS clients semés (numéros 200-555-01NN à 202-555-01NN, adresses « masse-… ») : une facture
  // d'un autre test du même bureau, au même jalon, réagit aussi à la règle (passe du 2026-10-01 : 2 textos de trop).
  return lignes.filter((l) => /^\+120[0-2]55501\d\d$/.test(l.destinataire) || l.destinataire.startsWith('masse-'));
}

/** Attend que le nombre d'envois marqués ne bouge plus pendant 4 s. */
async function stabiliser(m: string): Promise<number> {
  let avant = -1; let stable = 0;
  for (let i = 0; i < 120; i++) {
    const n = (await envoisDe(m)).length;
    stable = n === avant ? stable + 1 : 0;
    if (stable >= 2) return n;
    avant = n;
    await pause(2_000);
  }
  return avant;
}

/** Recule de `minutes` les journaux de textos et les échéances en attente de NOTRE bureau : le temps a passé. */
async function vieillir(ruleId: string, minutes: number): Promise<void> {
  const sql = async (table: string, colonne: string, filtre: (q: any) => any) => {
    const lignes = await ok<Array<Record<string, string>>>(filtre(b.admin.from(table).select(`id, ${colonne}`).eq('org_id', b.orgA).eq('automation_rule_id', ruleId)).limit(2000), `lecture ${table}`);
    for (let i = 0; i < lignes.length; i += 50) {
      await Promise.all(lignes.slice(i, i + 50).map((l) =>
        b.admin.from(table).update({ [colonne]: new Date(Date.parse(l[colonne]) - minutes * 60_000).toISOString() }).eq('id', l.id)));
    }
  };
  await sql('automation_execution_logs', 'created_at', (q) => q.eq('action_type', 'send_sms').gte('created_at', new Date(Date.now() - 2 * 60_000).toISOString()));
  await sql('automation_scheduled_tasks', 'execute_at', (q) => q.eq('status', 'pending'));
}

beforeAll(async () => { b = await preparerBureau(); });

describe(`point 14 — A. ${N} factures en retard la même nuit, automatisation « texto immédiat »`, () => {
  const m = marque('B14-sms');
  let ruleId = '';

  beforeAll(async () => {
    const { detectOverdueInvoices, viderFile } = await import('../../../server/lib/scheduler');
    await semer(m, N);
    ruleId = await regle(b, m, { trigger_event: 'invoice.overdue', conditions: { days_overdue: 1 }, actions: [texto(m, 'Votre facture est en retard')] });

    const t0 = Date.now();
    await detectOverdueInvoices(b.admin, { orgId: b.orgA });
    const emission = Date.now() - t0;
    const immediats = await stabiliser(m);
    const lignes = await envoisDe(m);
    const premier = lignes.length ? Date.parse(lignes[0].created_at) : 0;
    const dansLaPremiereMinute = lignes.filter((l) => Date.parse(l.created_at) - premier < 60_000).length;
    const enFile = await ok<Array<{ id: string }>>(b.admin.from('automation_scheduled_tasks').select('id').eq('automation_rule_id', ruleId).eq('status', 'pending').limit(2000), 'file');
    Object.assign(mesures, { textos: { factures: N, emission_ms: emission, partis_sans_passer_par_la_file: immediats, partis_dans_la_premiere_minute: dansLaPremiereMinute, en_file_apres_emission: enFile.length } });

    // Les ticks de 5 minutes, jusqu'à vider la file (borne : 40 ticks = 3 h 20).
    const parTick: number[] = [];
    let partis = immediats;
    for (let tick = 1; tick <= 40 && partis < N; tick++) {
      await vieillir(ruleId, 5);
      const debut = Date.now();
      await viderFile(b.admin, { orgId: b.orgA });
      const duree = Date.now() - debut;
      const maintenant = (await envoisDe(m)).length;
      parTick.push(maintenant - partis);
      partis = maintenant;
      mesures.textos[`tick_${tick}_ms`] = duree;
      if (parTick.slice(-3).every((x) => x === 0) && parTick.length >= 3) break;
    }
    const notif = await ok<Array<{ body: string }>>(b.admin.from('notifications').select('body').eq('org_id', b.orgA).eq('type', 'automation_burst').order('created_at', { ascending: false }).limit(1), 'notification');
    const etats = await ok<Array<{ status: string }>>(b.admin.from('automation_scheduled_tasks').select('status').eq('automation_rule_id', ruleId).limit(2000), 'états');
    Object.assign(mesures.textos, {
      textos_par_tick_de_5_min: parTick,
      total_partis: partis,
      ticks_pour_tout_envoyer: parTick.length,
      minutes_avant_le_dernier_texto: parTick.length * 5,
      taches_par_etat: etats.reduce<Record<string, number>>((a, t) => { a[t.status] = (a[t.status] ?? 0) + 1; return a; }, {}),
      notification_rafale: notif[0]?.body ?? null,
    });
  }, 1_800_000);

  it(`[B14-01] aucune perte : les ${N} textos finissent par partir, une fois chacun`, () => {
    expect(mesures.textos.total_partis).toBe(N);
  });

  it('[B14-02] l’étalement tient sa promesse dans la PREMIÈRE minute : au plus 30 textos', () => {
    expect(mesures.textos.partis_dans_la_premiere_minute, `${mesures.textos.partis_dans_la_premiere_minute} textos partis dans la première minute`).toBeLessThanOrEqual(30);
  });

  it(`[B14-03] « 30 par minute » : le ${N}e texto part en ${Math.ceil(N / 30)} minutes environ (pas en heures)`, () => {
    // La notification envoyée au propriétaire annonce « au rythme de 30 par minute ».
    expect(String(mesures.textos.notification_rafale)).toMatch(/30 par minute/);
    expect(mesures.textos.minutes_avant_le_dernier_texto, `rythme réel : ${JSON.stringify(mesures.textos.textos_par_tick_de_5_min)} par tick de 5 min`).toBeLessThanOrEqual(Math.ceil(N / 30) + 5);
  });
});

describe(`point 14 — B. ${N} factures en retard la même nuit, automatisation « courriel immédiat »`, () => {
  const m = marque('B14-courriel');

  beforeAll(async () => {
    const { detectOverdueInvoices } = await import('../../../server/lib/scheduler');
    // Les règles du volet A ne doivent plus réagir.
    await ok(b.admin.from('automation_rules').update({ is_active: false }).eq('org_id', b.orgA).eq('trigger_event', 'invoice.overdue'), 'règles A éteintes');
    await semer(m, N);
    const ruleId = await regle(b, m, { trigger_event: 'invoice.overdue', conditions: { days_overdue: 1 }, actions: [courriel(m, 'Votre facture est en retard')] });

    // Latence d'une lecture ordinaire de l'app (liste de clients), au repos puis pendant la rafale.
    const lire = async () => { const t = Date.now(); await b.admin.from('clients').select('id, first_name').eq('org_id', b.orgA).limit(20); return Date.now() - t; };
    const repos: number[] = [];
    for (let i = 0; i < 30; i++) { repos.push(await lire()); await pause(50); }
    const pendant: number[] = [];
    let mesurer = true;
    const sonde = (async () => { while (mesurer) { pendant.push(await lire()); await pause(50); } })();

    const t0 = Date.now();
    await detectOverdueInvoices(b.admin, { orgId: b.orgA });
    const emission = Date.now() - t0;
    const partis = await stabiliser(m);
    const duree = Date.now() - t0;
    mesurer = false; await sonde;

    const lignes = await envoisDe(m);
    const parSeconde = new Map<number, number>();
    for (const l of lignes) { const s = Math.floor(Date.parse(l.created_at) / 1000); parSeconde.set(s, (parSeconde.get(s) ?? 0) + 1); }
    const journaux = await ok<Array<{ result_success: boolean; result_error: string | null; duration_ms: number | null }>>(
      b.admin.from('automation_execution_logs').select('result_success, result_error, duration_ms').eq('automation_rule_id', ruleId).limit(2000), 'journaux');
    const centile = (t: number[], p: number) => [...t].sort((x, y) => x - y)[Math.min(t.length - 1, Math.floor(t.length * p))] ?? 0;
    Object.assign(mesures, {
      courriels: {
        factures: N, emission_ms: emission, partis, duree_totale_ms: duree,
        premier_au_dernier_ms: lignes.length ? Date.parse(lignes[lignes.length - 1].created_at) - Date.parse(lignes[0].created_at) : 0,
        pointe_par_seconde: Math.max(0, ...parSeconde.values()),
        echecs: journaux.filter((j) => !j.result_success).length,
        erreurs: [...new Set(journaux.filter((j) => !j.result_success).map((j) => String(j.result_error).slice(0, 80)))],
        duree_action_p95_ms: centile(journaux.map((j) => j.duration_ms ?? 0), 0.95),
        lecture_app_au_repos_ms: { p50: centile(repos, 0.5), p95: centile(repos, 0.95) },
        lecture_app_pendant_ms: { p50: centile(pendant, 0.5), p95: centile(pendant, 0.95), max: Math.max(0, ...pendant) },
      },
    });
  }, 900_000);

  it(`[B14-10] aucune perte : les ${N} courriels partent, aucun échec`, () => {
    expect(mesures.courriels.partis).toBe(N);
    expect(mesures.courriels.echecs).toBe(0);
  });

  it('[B14-11] le débit des courriels est régulé sous la limite du fournisseur (SES : 14 par seconde par défaut)', () => {
    expect(mesures.courriels.pointe_par_seconde, `pointe mesurée : ${mesures.courriels.pointe_par_seconde} courriels dans la même seconde`).toBeLessThanOrEqual(14);
  });
});
