/**
 * Point 2 — « les files survivent-elles à un redémarrage du serveur ? »
 * Preuve sur la pile LOCALE, en TUANT le processus du moteur en plein travail.
 *
 *   QA_AUTO_SUFFIXE=b node --import tsx scripts/qa/finale/b/redemarrage.mts
 *
 * Volet 1 — la file planifiée : 40 tâches dues, un processus « serveur » les
 *   dépile (le vrai `viderFile`), on le tue (SIGKILL) dès qu'une tâche est
 *   `running`. Puis un nouveau processus démarre (le redémarrage), puis
 *   16 minutes passent (l'échéance de la tâche orpheline est reculée).
 * Volet 2 — les événements en vol : un processus émet 30 événements d'une
 *   règle immédiate et meurt avant d'avoir fini ; on rejoue les orphelins de
 *   NOTRE bureau par le même chemin que l'outbox (`eventBus.rejouer`).
 *
 * Tout se passe dans le bureau A « (b) », en bac à sable ; fournisseurs piégés
 * par le même fichier que la suite (harnais/env-integration.ts).
 * Sortie : D:/lume-final/sorties/b/redemarrage.json
 */
import '../../../../tests/automations-suite/harnais/env-integration';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { demarrerMoteur, marque } from '../../../../tests/automations-suite/harnais/moteur';

const role = process.argv[2] ?? 'parent';
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const b = await demarrerMoteur();

// ── Rôles « enfant » : un serveur qui travaille, et qu'on tue ───────────────
if (role === 'file') {
  const { viderFile } = await import('../../../../server/lib/scheduler');
  console.log('enfant: file');
  await viderFile(b.admin, { orgId: b.orgA });
  console.log('enfant: fini');
  process.exit(0);
}
if (role === 'evenements') {
  const clients = JSON.parse(process.argv[3]) as string[];
  console.log('enfant: evenements');
  for (const id of clients) await b.eventBus.emit('note.added' as never, { orgId: b.orgA, entityType: 'client', entityId: id, metadata: {} } as never);
  await pause(60_000); // les écouteurs tournent ; le parent nous tue avant
  process.exit(0);
}

// ── Parent ───────────────────────────────────────────────────────────────────
const moi = fileURLToPath(import.meta.url);
function enfant(args: string[]) {
  const p = spawn(process.execPath, ['--import', 'tsx', moi, ...args], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let sortie = '';
  p.stdout.on('data', (d) => { sortie += d; });
  p.stderr.on('data', (d) => { sortie += d; });
  const fin = new Promise<number | null>((r) => p.once('exit', (code) => r(code)));
  return { p, fin, sortie: () => sortie };
}

async function ok<T>(q: PromiseLike<{ data: unknown; error: { message: string } | null }>, quoi: string): Promise<T> {
  const { data, error } = await q;
  if (error) throw new Error(`${quoi} : ${error.message}`);
  return data as T;
}

async function clients(m: string, n: number): Promise<string[]> {
  const maintenant = new Date().toISOString();
  const lignes = await ok<Array<{ id: string }>>(b.admin.from('clients').insert(Array.from({ length: n }, (_, i) => ({
    org_id: b.orgA, created_by: b.users.proprioA, first_name: 'Redémarrage', last_name: `${m} ${i}`, status: 'active',
    email: `redem-${Date.now().toString(36)}-${i}@lume-qa.test`, phone: `+1${300 + Math.floor(i / 100)}55501${String(i % 100).padStart(2, '0')}`,
    sms_consent_at: maintenant, email_consent_at: maintenant,
  }))).select('id'), 'clients');
  return lignes.map((l) => l.id);
}

const etats = async (ruleId: string) => {
  const t = await ok<Array<{ status: string }>>(b.admin.from('automation_scheduled_tasks').select('status').eq('automation_rule_id', ruleId).limit(1000), 'tâches');
  return t.reduce<Record<string, number>>((a, x) => { a[x.status] = (a[x.status] ?? 0) + 1; return a; }, {});
};
const envois = async (m: string) => ok<Array<{ destinataire: string }>>(b.admin.from('envois_simules').select('destinataire').eq('org_id', b.orgA).like('corps', `%${m}%`).limit(2000), 'envois');
const doublons = (l: Array<{ destinataire: string }>) => l.length - new Set(l.map((x) => x.destinataire)).size;

const resultat: Record<string, unknown> = {};
const regles: string[] = [];
try {
  // ════════ Volet 1 — la file planifiée ════════
  const m1 = marque('B2-redemarrage-file');
  const N1 = 40;
  const r1 = await ok<{ id: string }>(b.admin.from('automation_rules').insert({
    org_id: b.orgA, name: m1, trigger_event: 'note.added', conditions: {}, delay_seconds: 3600, is_active: true, is_preset: false,
    actions: [{ type: 'send_email', config: { subject: `Sujet ${m1}`, body: `<p>Relance ${m1}</p>` } }], settings: { fenetre: { debut: 0, fin: 24 } },
  }).select('id').single(), 'règle 1');
  regles.push(r1.id);
  const c1 = await clients(m1, N1);
  for (const id of c1) await b.eventBus.emit('note.added' as never, { orgId: b.orgA, entityType: 'client', entityId: id, metadata: {} } as never);
  for (let i = 0; i < 100 && ((await etats(r1.id)).pending ?? 0) < N1; i++) await pause(300);
  const planifiees = await etats(r1.id);
  await ok(b.admin.from('automation_scheduled_tasks').update({ execute_at: new Date(Date.now() - 1_000).toISOString() }).eq('automation_rule_id', r1.id).eq('status', 'pending'), 'rendre dues');

  // Le « serveur » dépile ; on le tue dès qu'une tâche est en cours et que quelques-unes sont faites.
  const serveur = enfant(['file']);
  let tue = false;
  const debut = Date.now();
  while (Date.now() - debut < 120_000) {
    const e = await etats(r1.id);
    if ((e.running ?? 0) > 0 && (e.completed ?? 0) >= 3) { serveur.p.kill('SIGKILL'); tue = true; break; }
    if ((e.pending ?? 0) === 0 && (e.running ?? 0) === 0) break;
    await pause(15);
  }
  await serveur.fin;
  await pause(1_000);
  const apresArret = await etats(r1.id);
  const envoisApresArret = (await envois(m1)).length;

  // Le redémarrage : un nouveau processus, tout de suite.
  const relance = enfant(['file']);
  await relance.fin;
  const apresRedemarrage = await etats(r1.id);
  const envoisApresRedemarrage = (await envois(m1)).length;

  // 16 minutes plus tard : l'échéance de la tâche orpheline (= l'heure de sa prise) est reculée.
  await ok(b.admin.from('automation_scheduled_tasks').update({ execute_at: new Date(Date.now() - 16 * 60_000).toISOString() }).eq('automation_rule_id', r1.id).eq('status', 'running'), 'vieillir');
  const plusTard = enfant(['file']);
  await plusTard.fin;
  const apres16min = await etats(r1.id);
  const finaux = await envois(m1);

  resultat.file = {
    taches: N1, planifiees, processus_tue_en_plein_travail: tue,
    juste_apres_l_arret: { ...apresArret, envois: envoisApresArret },
    apres_le_redemarrage_immediat: { ...apresRedemarrage, envois: envoisApresRedemarrage },
    seize_minutes_plus_tard: { ...apres16min, envois: finaux.length, envois_en_double: doublons(finaux) },
  };

  // ════════ Volet 2 — les événements en vol ════════
  const m2 = marque('B2-redemarrage-evenements');
  const N2 = 30;
  const r2 = await ok<{ id: string }>(b.admin.from('automation_rules').insert({
    org_id: b.orgA, name: m2, trigger_event: 'note.added', conditions: {}, delay_seconds: 0, is_active: true, is_preset: false,
    actions: [{ type: 'send_email', config: { subject: `Sujet ${m2}`, body: `<p>Confirmation ${m2}</p>` } }],
  }).select('id').single(), 'règle 2');
  regles.push(r2.id);
  // La règle du volet 1 ne doit pas réagir aux événements du volet 2.
  await ok(b.admin.from('automation_rules').update({ is_active: false }).eq('id', r1.id), 'règle 1 éteinte');
  const c2 = await clients(m2, N2);
  const depuis = new Date(Date.now() - 2_000).toISOString();
  const consignes = async () => ok<Array<{ id: number; entity_id: string; processed_at: string | null }>>(
    b.admin.from('domain_events').select('id, entity_id, processed_at').eq('org_id', b.orgA).eq('type', 'note.added').in('entity_id', c2).gte('created_at', depuis), 'outbox');

  const emetteur = enfant(['evenements', JSON.stringify(c2)]);
  let tue2 = false;
  const debut2 = Date.now();
  while (Date.now() - debut2 < 120_000) {
    const l = await consignes();
    if (l.length >= 12) { emetteur.p.kill('SIGKILL'); tue2 = true; break; }
    await pause(10);
  }
  await emetteur.fin;
  await pause(1_500);
  const apresArret2 = await consignes();
  const envoisApresArret2 = await envois(m2);
  const orphelins = apresArret2.filter((l) => !l.processed_at);

  // Le rejeu de l'outbox (délai de grâce de 3 min écoulé), restreint à NOTRE bureau : même chemin
  // que rejouerEvenementsOrphelins (server/lib/outbox.ts) — réclamation, puis eventBus.rejouer.
  const lignes = await ok<Array<Record<string, any>>>(b.admin.from('domain_events').select('*').in('id', orphelins.map((o) => o.id).concat(-1)), 'orphelins');
  for (const l of lignes) {
    await b.admin.from('domain_events').update({ attempts: (l.attempts ?? 0) + 1 }).eq('id', l.id).is('processed_at', null);
    await b.eventBus.rejouer(l.id, {
      type: l.type, orgId: l.org_id, entityType: l.entity_type, entityId: l.entity_id, metadata: l.metadata ?? {},
      outboxId: l.id, reglesTraitees: [...(l.regles_traitees ?? [])], rejoueDepuis: l.created_at,
    } as never);
  }
  await pause(3_000);
  const apresRejeu = await consignes();
  const envoisFinaux2 = await envois(m2);
  // Les réservations laissées « en cours » par le processus tué : l'action n'a jamais été exécutée.
  const journaux2 = await ok<Array<{ result_success: boolean; result_error: string | null }>>(
    b.admin.from('automation_execution_logs').select('result_success, result_error').eq('automation_rule_id', r2.id).limit(1000), 'journaux');
  resultat.evenements = {
    evenements_a_emettre: N2, processus_tue_en_plein_travail: tue2,
    juste_apres_l_arret: { consignes: apresArret2.length, traites: apresArret2.length - orphelins.length, orphelins: orphelins.length, envois: envoisApresArret2.length },
    jamais_consignes_donc_perdus: N2 - apresArret2.length,
    apres_le_rejeu: { non_traites: apresRejeu.filter((l) => !l.processed_at).length, envois: envoisFinaux2.length, envois_en_double: doublons(envoisFinaux2), clients_sans_envoi_parmi_les_consignes: apresRejeu.length - new Set(envoisFinaux2.map((e) => e.destinataire)).size,
      journaux_reussis: journaux2.filter((j) => j.result_success).length,
      journaux_restes_en_cours: journaux2.filter((j) => j.result_error === 'en cours').length },
  };
} finally {
  if (regles.length) await b.admin.from('automation_rules').delete().in('id', regles);
  mkdirSync('D:/lume-final/sorties/b', { recursive: true });
  writeFileSync('D:/lume-final/sorties/b/redemarrage.json', JSON.stringify(resultat, null, 2));
  console.log(JSON.stringify(resultat, null, 2));
}
process.exit(0);
