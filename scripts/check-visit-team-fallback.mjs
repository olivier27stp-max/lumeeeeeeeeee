/**
 * check-visit-team-fallback.mjs — Compte les visites actives dont team_id est
 * NULL alors que leur job a une équipe (elles dépendent du fallback
 * d'affichage ev.team_id ?? job.team_id du calendrier).
 *
 * Usage :
 *   node scripts/check-visit-team-fallback.mjs            → compte seulement
 *   node scripts/check-visit-team-fallback.mjs --apply    → backfill event.team_id = job.team_id
 *   ENV_FILE=/chemin/.env.local pour choisir le projet (défaut : Downloads/lume-crm/.env.local)
 */
import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const envFile = process.env.ENV_FILE || '/Users/olivierst-pierre/Downloads/lume-crm/.env.local';
if (!existsSync(envFile)) { console.error(`Fichier env introuvable : ${envFile}`); process.exit(1); }
config({ path: envFile });

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('VITE_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis.'); process.exit(1); }
console.log(`Projet : ${new URL(url).hostname.split('.')[0]}`);
const admin = createClient(url, key);

const { data: events, error } = await admin
  .from('schedule_events')
  .select('id, job_id, start_at, status')
  .is('deleted_at', null)
  .is('team_id', null);
if (error) { console.error('schedule_events:', error.message); process.exit(1); }
console.log(`Visites actives sans team_id : ${events.length}`);
if (!events.length) process.exit(0);

const jobIds = [...new Set(events.map((e) => e.job_id).filter(Boolean))];
const { data: jobs, error: jErr } = await admin
  .from('jobs')
  .select('id, team_id, title')
  .in('id', jobIds);
if (jErr) { console.error('jobs:', jErr.message); process.exit(1); }
const teamByJob = new Map(jobs.map((j) => [j.id, j.team_id]));
const titleByJob = new Map(jobs.map((j) => [j.id, j.title]));

const relying = events.filter((e) => teamByJob.get(e.job_id));
console.log(`… dont le job A une équipe (dépendent du fallback) : ${relying.length}`);
for (const e of relying) {
  console.log(`  event ${e.id}  job "${titleByJob.get(e.job_id)}"  ${e.start_at}  status=${e.status}`);
}

if (process.argv.includes('--apply') && relying.length) {
  let ok = 0;
  for (const e of relying) {
    const { error: uErr } = await admin
      .from('schedule_events')
      .update({ team_id: teamByJob.get(e.job_id), updated_at: new Date().toISOString() })
      .eq('id', e.id)
      .is('team_id', null);
    if (uErr) console.error(`  ÉCHEC event ${e.id}:`, uErr.message);
    else ok++;
  }
  console.log(`Backfill appliqué : ${ok}/${relying.length} visites estampillées avec l'équipe de leur job.`);
}
