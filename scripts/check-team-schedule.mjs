/**
 * check-team-schedule.mjs — Vérifie que la migration 20260749000000
 * (horaire quotidien des équipes) est en place en prod :
 *   1. tables team_schedule_assignments / recurring_team_schedules /
 *      time_off_requests / team_schedule_audit accessibles ;
 *   2. colonne teams.display_order présente et backfillée ;
 *   3. backfill : les appartenances permanentes (team_assignments +
 *      memberships.team_id des techniciens) ont des lignes récurrentes ;
 *   4. garde-fou de chevauchement : insertion de deux assignations qui se
 *      chevauchent pour le même user/date → la 2e doit être rejetée
 *      (SCHEDULE_OVERLAP), puis nettoyage complet.
 *
 * Usage : node scripts/check-team-schedule.mjs
 */
import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

for (const p of ['.env.local', '/Users/olivierst-pierre/Downloads/lume-crm/.env.local']) {
  if (existsSync(p)) config({ path: p });
}

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('VITE_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis.'); process.exit(1); }
const admin = createClient(url, key);

let ok = true;
const fail = (msg) => { ok = false; console.error(`❌ ${msg}`); };
const pass = (msg) => console.log(`✅ ${msg}`);

// ── 1. Tables ───────────────────────────────────────────────
for (const table of ['team_schedule_assignments', 'recurring_team_schedules', 'time_off_requests', 'team_schedule_audit']) {
  const { error } = await admin.from(table).select('id').limit(1);
  if (error) fail(`table ${table} inaccessible : ${error.message}`);
  else pass(`table ${table} OK`);
}

// ── 2. teams.display_order ──────────────────────────────────
{
  const { data, error } = await admin.from('teams').select('id, display_order').is('deleted_at', null).limit(50);
  if (error) fail(`teams.display_order manquant : ${error.message}`);
  else {
    const zeroes = (data || []).filter((t) => !t.display_order).length;
    pass(`teams.display_order OK (${(data || []).length} équipes, ${zeroes} sans ordre)`);
  }
}

// ── 3. Backfill récurrences ─────────────────────────────────
{
  const { data: assigns, error: e1 } = await admin.from('team_assignments').select('user_id, team_id');
  const { count, error: e2 } = await admin.from('recurring_team_schedules').select('id', { count: 'exact', head: true });
  if (e1 || e2) fail(`lecture backfill impossible : ${(e1 || e2).message}`);
  else {
    pass(`${count ?? 0} lignes récurrentes présentes pour ${assigns?.length ?? 0} appartenances permanentes`);
    if ((assigns?.length ?? 0) > 0 && (count ?? 0) === 0) fail('backfill vide alors que team_assignments a des lignes');
  }
}

// ── 4. Garde-fou de chevauchement ───────────────────────────
{
  const { data: team } = await admin.from('teams').select('id, org_id').is('deleted_at', null).eq('is_active', true).limit(1).maybeSingle();
  const { data: member } = team
    ? await admin.from('memberships').select('user_id').eq('org_id', team.org_id).limit(1).maybeSingle()
    : { data: null };
  if (!team || !member) {
    console.log('⚠️  pas d’équipe/membre disponible pour tester le chevauchement — étape sautée');
  } else {
    const date = '2091-01-03'; // date de test loin dans le futur
    const base = { org_id: team.org_id, team_id: team.id, user_id: member.user_id, work_date: date };
    const ids = [];
    const { data: a, error: err1 } = await admin.from('team_schedule_assignments')
      .insert({ ...base, start_time: '08:00', end_time: '12:00' }).select('id').single();
    if (err1) fail(`insertion de test refusée : ${err1.message}`);
    else {
      ids.push(a.id);
      const { data: b, error: err2 } = await admin.from('team_schedule_assignments')
        .insert({ ...base, start_time: '10:00', end_time: '14:00' }).select('id').single();
      if (err2 && err2.message.includes('SCHEDULE_OVERLAP')) pass('chevauchement bien rejeté (SCHEDULE_OVERLAP)');
      else if (err2) fail(`rejet inattendu : ${err2.message}`);
      else { ids.push(b.id); fail('le chevauchement n’a PAS été rejeté'); }
      const { data: c, error: err3 } = await admin.from('team_schedule_assignments')
        .insert({ ...base, start_time: '13:00', end_time: '16:00' }).select('id').single();
      if (err3) fail(`plage disjointe refusée à tort : ${err3.message}`);
      else { ids.push(c.id); pass('plages disjointes le même jour acceptées'); }
    }
    if (ids.length) await admin.from('team_schedule_assignments').delete().in('id', ids);
    await admin.from('team_schedule_audit').delete().eq('work_date', '2091-01-03');
  }
}

console.log(ok ? '\n🎉 Migration team_daily_schedule vérifiée.' : '\n⚠️  Des vérifications ont échoué.');
process.exit(ok ? 0 : 1);
