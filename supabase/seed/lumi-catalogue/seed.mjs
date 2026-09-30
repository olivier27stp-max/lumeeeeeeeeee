#!/usr/bin/env node
/**
 * Seed du catalogue de tâches Lumi — STAGING SEULEMENT, idempotent.
 * ─────────────────────────────────────────────────────────────────────────
 *   node --env-file=.env.local --import tsx supabase/seed/lumi-catalogue/seed.mjs
 *   (ou : npm run seed:lumi-catalogue)
 *
 * Ce qu'il fait, dans l'ordre :
 *  1. refuse de tourner si la cible est la prod ;
 *  2. crée (ou retrouve) les 8 comptes de test (@resend.dev) par l'API admin d'Auth ;
 *  3. crée (ou retrouve) 2 entreprises / 3 bureaux, puis VIDE leurs données
 *     (sauf journaux append-only et traces de coût IA) — c'est ce qui rend le
 *     seed rejouable : même point de départ à chaque passe ;
 *  4. repasse ce qu'une vraie inscription crée : préréglages SQL d'automatisation,
 *     pipeline de ventes, puis le seeder applicatif (pack de base publié,
 *     sollicitations commerciales en brouillon) et les taxes du Québec ;
 *  5. insère le jeu de donnees.mjs (identifiants déterministes, dates ancrées
 *     sur aujourd'hui à Montréal) ;
 *  6. vérifie en base que les chiffres attendus par le catalogue (faits.mjs)
 *     tombent juste, et sort en erreur sinon.
 *
 * Rouler de préférence entre 9 h et 23 h (heure de Montréal) : quelques
 * événements « d'aujourd'hui » sont datés du matin.
 *
 * Variables (.env.local) : VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF (staging), SUPABASE_PROJECT_REF_PROD.
 * Facultatif : LUMI_SEED_MOT_DE_PASSE (sinon connexion par lien magique, voir README).
 */
import { createClient } from '@supabase/supabase-js';
import {
  BUREAUX, GROUPES, PERSONNES, EQUIPES, SERVICES, CLIENTS, MARQUEUR, FUSEAU,
  idDe, iso, horodatage, construireCalendrier, construireJeu, client as clientDe, nomClient, plusJours,
} from './donnees.mjs';
import { calculerFaits, verificationsSql } from './faits.mjs';

// ── 1. Garde-fous ────────────────────────────────────────────────────────
const ref = process.env.SUPABASE_PROJECT_REF;
const refProd = process.env.SUPABASE_PROJECT_REF_PROD;
const url = process.env.VITE_SUPABASE_URL ?? '';
const jeton = process.env.SUPABASE_ACCESS_TOKEN;
if (!ref || !jeton || !url || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('ERREUR : VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ACCESS_TOKEN et SUPABASE_PROJECT_REF sont requis.');
  process.exit(2);
}
if (!refProd || ref === refProd || url.includes(refProd)) {
  console.error('REFUS : la cible est la PRODUCTION (ou SUPABASE_PROJECT_REF_PROD est absent, donc impossible de le vérifier).');
  process.exit(2);
}
if (!url.includes(ref)) {
  console.error(`REFUS : VITE_SUPABASE_URL ne pointe pas sur le projet ${ref}.`);
  process.exit(2);
}

const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

async function sql(requete) {
  for (let essai = 1; ; essai++) {
    const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: 'POST', headers: { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: requete }),
    });
    const txt = await r.text();
    if (r.ok) return JSON.parse(txt);
    // L'API de gestion limite le débit : on patiente au lieu d'échouer.
    if ((r.status === 429 || r.status >= 500) && essai < 5) { await new Promise((ok) => setTimeout(ok, 1500 * essai)); continue; }
    throw new Error(`SQL HTTP ${r.status} : ${txt.slice(0, 1500)}`);
  }
}

/** Littéral SQL sûr. */
function L(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  return `'${String(v).replace(/'/g, "''")}'`;
}
const U = (cle) => `'${idDe(cle)}'::uuid`;

const cal = construireCalendrier();
const jeu = construireJeu(cal);
console.log(`Cible : staging (${ref}) — ancre ${iso(cal.ancre)} (${FUSEAU})\n`);

// ── 2. Comptes de test ───────────────────────────────────────────────────
const uid = {};
{
  const existants = await sql(`select id, email from auth.users where email in (${Object.values(PERSONNES).map((p) => L(p.courriel)).join(',')})`);
  for (const p of Object.values(PERSONNES)) {
    let id = existants.find((e) => e.email === p.courriel)?.id;
    if (!id) {
      const { data, error } = await admin.auth.admin.createUser({
        email: p.courriel, email_confirm: true,
        ...(process.env.LUMI_SEED_MOT_DE_PASSE ? { password: process.env.LUMI_SEED_MOT_DE_PASSE } : {}),
        user_metadata: { full_name: p.nomComplet, lumi_catalogue: true },
      });
      if (error) throw new Error(`création du compte ${p.courriel} : ${error.message}`);
      id = data.user.id;
      console.log(`  compte créé : ${p.courriel}`);
    } else if (process.env.LUMI_SEED_MOT_DE_PASSE) {
      const { error } = await admin.auth.admin.updateUserById(id, { password: process.env.LUMI_SEED_MOT_DE_PASSE });
      if (error) throw new Error(`mot de passe de ${p.courriel} : ${error.message}`);
    }
    uid[p.cle] = id;
  }
  console.log(`Comptes : ${Object.keys(uid).length} prêts.`);
}
const UID = (cle) => { if (!uid[cle]) throw new Error(`personne inconnue : ${cle}`); return `'${uid[cle]}'::uuid`; };

// ── 3. Entreprises, bureaux, purge ───────────────────────────────────────
const orgIds = Object.values(BUREAUX).map((b) => b.id);
const proprioDe = (bureau) => (bureau === 'boreal' ? 'autre' : 'proprio');
await sql(Object.entries(BUREAUX).map(([cle, b]) => `
  insert into public.company_groups (id, name) values ('${GROUPES[b.groupe].id}', ${L(GROUPES[b.groupe].nom)}) on conflict (id) do update set name = excluded.name;
  insert into public.orgs (id, name, created_by, company_group_id) values ('${b.id}', ${L(b.nom)}, ${UID(proprioDe(cle))}, '${GROUPES[b.groupe].id}')
    on conflict (id) do update set name = excluded.name, deleted_at = null, archived_at = null;`).join('\n'));

// Tables conservées : journaux append-only (audit_events refuse DELETE), traces de coût IA
// (un seed ne doit pas effacer la dépense réelle), réglages créés par le seul trigger de l'org.
const GARDER = ['audit_events', 'ai_usage', 'ai_usage_monthly', 'ai_reservations', 'lumi_conversations', 'lumi_messages',
  'lumi_traces', 'lumi_briefings', 'lumi_autorisations', 'communication_settings', 'custom_field_folders', 'security_events',
  'login_history', 'active_sessions', 'data_export_log'];
const [purge] = await sql(`
do $$
declare v_orgs uuid[] := array[${orgIds.map((o) => `'${o}'::uuid`).join(',')}]; t record; v_n int; v_total int := 0; v_passe int;
begin
  for v_passe in 1..6 loop
    v_n := 0;
    for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
              where c.relkind = 'r' and c.relname <> all (array[${GARDER.map(L).join(',')}])
                and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'org_id' and not a.attisdropped)
    loop
      begin
        execute format('delete from public.%I where org_id = any($1)', t.relname) using v_orgs;
        get diagnostics v_n = row_count; v_total := v_total + v_n;
      exception when others then null; -- clé étrangère : la passe suivante s'en chargera
      end;
    end loop;
  end loop;
  create temp table if not exists _purge(n int) on commit drop; insert into _purge values (v_total);
end $$;
select n from _purge;`);
console.log(`Purge : ${purge?.n ?? '?'} ligne(s) supprimée(s) dans les bureaux de test.`);

// Profils, adhésions, réglages d'entreprise, abonnement, préréglages SQL de la création d'org.
const [{ id: planAutopilot } = {}] = await sql(`select id from public.plans where slug = 'autopilot' limit 1`);
if (!planAutopilot) throw new Error('plan autopilot introuvable');
{
  const blocs = [];
  for (const p of Object.values(PERSONNES)) {
    blocs.push(`insert into public.profiles (id, full_name, onboarding_done) values (${UID(p.cle)}, ${L(p.nomComplet)}, true)
      on conflict (id) do update set full_name = excluded.full_name, onboarding_done = true;`);
    for (const b of p.bureaux) {
      const perms = p.permissions ?? {};
      blocs.push(`insert into public.memberships (user_id, org_id, role, status, scope, permissions, permissions_custom, full_name, hourly_rate_cents, compensation_mode, team_id)
        values (${UID(p.cle)}, '${BUREAUX[b].id}', ${L(p.role)}, 'active', 'company', ${L(perms)}, ${L(Object.keys(perms).length > 0)}, ${L(p.nomComplet)}, ${p.taux}, ${L(p.mode)}, null)
        on conflict (user_id, org_id) do update set role = excluded.role, status = 'active', scope = 'company', permissions = excluded.permissions,
          permissions_custom = excluded.permissions_custom, full_name = excluded.full_name, hourly_rate_cents = excluded.hourly_rate_cents,
          compensation_mode = excluded.compensation_mode, suspended_at = null;`);
    }
  }
  for (const [cle, b] of Object.entries(BUREAUX)) {
    blocs.push(`insert into public.company_settings (org_id, created_by, company_name, phone, email, street1, city, province, postal_code, country, timezone, currency, default_language, industry, revenue_goal_cents, setup_completed, automations_paused)
      values ('${b.id}', ${UID(proprioDe(cle))}, ${L(b.entreprise)}, ${L(b.tel)}, ${L(b.courriel)}, ${L(b.rue)}, ${L(b.ville)}, 'QC', ${L(b.cp)}, 'Canada', ${L(FUSEAU)}, 'CAD', 'fr',
        ${L(cle === 'boreal' ? 'other' : 'window_cleaning')}, ${cle === 'qc' ? jeu.objectifs.revenuAnnuel : 0}, true, false);`);
    blocs.push(`insert into public.subscriptions (user_id, org_id, plan_id, status, interval, currency, current_period_start, current_period_end)
      values (${UID(proprioDe(cle))}, '${b.id}', '${planAutopilot}', 'active', 'monthly', 'CAD', now() - interval '1 day', now() + interval '1 year');`);
    blocs.push(`select public.seed_automation_presets('${b.id}'); select public.apply_automation_presets_fr('${b.id}');
      select public.apply_appointment_contract_link('${b.id}'); select public.seed_agreement_signed_preset('${b.id}');
      select public.seed_pipeline_ventes('${b.id}', ${L(b.pipeline)});`);
  }
  await sql(blocs.join('\n'));
}

// Ce que l'APPLICATION fait à l'inscription (pack de base publié, commercial en brouillon, taxes QC).
{
  const { ensureAutomationPresets } = await import('../../../server/lib/automationPresetSeeder.ts');
  const { seedTaxPreset } = await import('../../../server/lib/seedOrgDefaults.ts');
  for (const b of Object.values(BUREAUX)) {
    await ensureAutomationPresets(admin, b.id, { activateAll: true });
    await seedTaxPreset(admin, b.id, 'QC', true);
  }
  console.log('Préréglages de l\'app appliqués (automatisations du pack de base + taxes TPS/TVQ).');
}

// ── 5. Données ───────────────────────────────────────────────────────────
const O = (bureau) => `'${BUREAUX[bureau].id}'::uuid`;
const ts = (jour, hhmm) => L(horodatage(jour, hhmm));
const d = (jour) => (jour ? L(iso(jour)) : 'null');
const blocs = [];
const Q = (s) => blocs.push(s);

// Équipe, taux, services, étiquettes
for (const e of Object.values(EQUIPES)) {
  Q(`insert into public.teams (id, org_id, name, color_hex, description) values (${U('equipe.' + Object.keys(EQUIPES).find((k) => EQUIPES[k] === e))}, ${O(e.bureau)}, ${L(e.nom)}, ${L(e.couleur)}, 'Techniciens vitres et gouttières');`);
}
for (const p of Object.values(PERSONNES)) {
  if (p.equipe) {
    Q(`insert into public.team_assignments (org_id, user_id, team_id, is_primary) values (${O(p.bureaux[0])}, ${UID(p.cle)}, ${U('equipe.' + p.equipe)}, true);
       update public.memberships set team_id = ${U('equipe.' + p.equipe)} where user_id = ${UID(p.cle)} and org_id = ${O(p.bureaux[0])};`);
  }
  for (const b of p.bureaux) {
    Q(`update public.team_members set hourly_rate_cents = ${p.taux}, compensation_mode = ${L(p.mode)}, first_name = ${L(p.prenom)}, last_name = ${L(p.nom)},
         phone = ${L('+15005550' + String(170 + Object.keys(PERSONNES).indexOf(p.cle)).padStart(3, '0'))}, team_id = ${p.equipe ? U('equipe.' + p.equipe) : 'null'}
       where org_id = ${O(b)} and user_id = ${UID(p.cle)};`);
  }
}
for (const wd of [1, 2, 3, 4, 5]) {
  Q(`insert into public.team_availability (org_id, team_id, weekday, start_minute, end_minute, timezone) values (${O('qc')}, ${U('equipe.vitres')}, ${wd}, 420, 1020, ${L(FUSEAU)});`);
}
Object.values(SERVICES).forEach((s, i) => {
  Q(`insert into public.predefined_services (id, org_id, name, description, default_price_cents, default_cost_cents, category, default_duration_minutes, sort_order, taxable)
     values ('${s.id}', ${O('qc')}, ${L(s.nom)}, ${L(s.nom)}, ${s.prix}, ${s.cout}, 'window_cleaning', ${s.duree}, ${i}, true);`);
});
for (const [nom, couleur] of [['résidentiel', '#10B981'], ['commercial', '#6366F1'], ['fidèle', '#F59E0B'], ['récurrent', '#0EA5E9']]) {
  Q(`insert into public.tags (org_id, name, color_hex) values (${O('qc')}, ${L(nom)}, ${L(couleur)});`);
}

// Clients et propriétés. L'adresse est posée APRÈS les propriétés : sinon le trigger
// clients_auto_property_from_address crée une « Adresse principale » à id aléatoire.
for (const k of CLIENTS) {
  const creation = k.creeCeMois ? horodatage(cal.ceMois(3), '10:00') : horodatage(plusJours(cal.ancre, -400 + CLIENTS.indexOf(k)), '10:00');
  Q(`insert into public.clients (id, org_id, first_name, last_name, company, display_as_company, email, phone, status, source, lead_source, city, province, postal_code, country,
       sms_consent_at, email_consent_at, notes, created_by, created_at, tags)
     values ('${k.id}', ${O(k.bureau)}, ${L(k.prenom)}, ${L(k.nom)}, ${L(k.entreprise ?? null)}, ${L(!!k.entreprise && k.cle !== 'paul_inj')}, ${L(k.courriel)}, ${L(k.tel)},
       ${L(k.statut)}, ${L(k.source ?? null)}, ${L(k.source ?? null)}, ${L(k.ville)}, 'QC', ${L(k.cp)}, 'Canada',
       ${k.consentement ? L(creation) : 'null'}, ${k.consentement ? L(creation) : 'null'}, ${L(k.cle === 'robert' ? k.note : null)}, ${UID(proprioDe(k.bureau))}, ${L(creation)}, ${L(`{${(k.etiquettes ?? []).map((e) => `"${e}"`).join(',')}}`)}::text[]);`);
  const props = k.proprietes ?? [{ cle: 'principale', nom: 'Adresse principale', adresse: k.adresse, ville: k.ville, cp: k.cp, principale: true }];
  for (const p of props) {
    Q(`insert into public.properties (id, org_id, client_id, name, address, street_name, city, province, postal_code, country, is_primary, kind, created_by)
       values (${U(`propriete.${k.cle}.${p.cle}`)}, ${O(k.bureau)}, '${k.id}', ${L(p.nom)}, ${L(`${p.adresse}, ${p.ville}, QC ${p.cp}`)}, ${L(p.adresse)}, ${L(p.ville)}, 'QC', ${L(p.cp)}, 'Canada', ${L(!!p.principale)}, 'service', ${UID(proprioDe(k.bureau))});`);
  }
  Q(`update public.clients set address = ${L(`${k.adresse}, ${k.ville}, QC ${k.cp}`)}${k.supprime ? `, deleted_at = ${ts(plusJours(cal.ancre, -90), '10:00')}, deleted_by = ${UID('proprio')}` : ''} where id = '${k.id}';`);
  for (const e of k.etiquettes ?? []) Q(`insert into public.client_tags (client_id, tag) values ('${k.id}', ${L(e)});`);
  if (k.carte) {
    Q(`insert into public.client_payment_profiles (org_id, client_id, stripe_customer_id, payment_method_id, card_brand, card_last4, card_exp_month, card_exp_year, consented_at, consent_source)
       values (${O(k.bureau)}, '${k.id}', ${L('cus_TESTLUMI_' + k.cle)}, ${L('pm_TESTLUMI_' + k.cle)}, ${L(k.carte.marque)}, ${L(k.carte.quatre)}, ${k.carte.mois}, ${k.carte.annee}, ${L(creation)}, 'public_pay');`);
  }
  if (k.smsStop) {
    Q(`insert into public.sms_opt_outs (org_id, phone, opted_out_at, reason) values (${O(k.bureau)}, ${L(k.tel)}, ${ts(plusJours(cal.ancre, -35), '19:02')}, 'client_stop');`);
  }
  if (k.consentement) {
    Q(`insert into public.consents (org_id, subject_type, subject_id, purpose, granted, method) values
       (${O(k.bureau)}, 'client', '${k.id}', 'sms-marketing', true, 'crm-manual'), (${O(k.bureau)}, 'client', '${k.id}', 'email-marketing', true, 'crm-manual');`);
  }
}

// Soumissions
const vendeur = (cle) => (cle ? UID(cle) : 'null');
for (const q of jeu.soumissions) {
  const k = clientDe(q.client);
  const depot = q.depot ? Math.round(q.total * q.depot / 100) : 0;
  Q(`insert into public.quotes (id, org_id, quote_number, title, client_id, lead_id, context_type, status, salesperson_id, created_by, created_at,
       sent_via_email_at, last_sent_channel, approved_at, declined_at, expired_at, converted_at, valid_until,
       subtotal_cents, tax_cents, total_cents, tax_rate_label, tax_rate, deposit_required, deposit_type, deposit_value, deposit_cents, deposit_status,
       property_id, view_count, is_viewed, viewed_at, last_viewed_at, archived_at)
     values ('${q.id}', ${O(q.bureau)}, ${L(q.numero)}, ${L(q.titre)}, '${k.id}', ${k.statut === 'lead' ? `'${k.id}'` : 'null'}, ${L(k.statut === 'lead' ? 'lead' : 'client')}, ${L(q.statut)},
       ${vendeur(q.vendeur)}, ${UID('proprio')}, ${ts(q.creee, '09:00')},
       ${q.envoyee ? ts(q.envoyee, '10:00') : 'null'}, ${q.envoyee ? "'email'" : 'null'}, ${q.approuvee ? ts(q.approuvee, '15:00') : 'null'}, ${q.refusee ? ts(q.refusee, '12:00') : 'null'},
       ${q.statut === 'expired' ? ts(q.valide, '23:59') : 'null'}, ${q.statut === 'converted' ? ts(q.approuvee, '16:00') : 'null'}, ${d(q.valide)},
       ${q.sousTotal}, ${q.tax}, ${q.total}, 'TPS+TVQ (14.975%)', 14.975, ${L(!!q.depot)}, ${q.depot ? "'percentage'" : 'null'}, ${q.depot ?? 0}, ${depot}, ${L(q.depot ? 'pending' : 'not_required')},
       ${U(`propriete.${k.cle}.${(k.proprietes ?? [{ cle: 'principale' }])[0].cle}`)}, ${q.vues ?? 0}, ${L((q.vues ?? 0) > 0)}, ${(q.vues ?? 0) > 0 ? ts(plusJours(q.envoyee, 1), '19:00') : 'null'},
       ${(q.vues ?? 0) > 0 ? ts(plusJours(q.envoyee, 2), '20:00') : 'null'}, ${q.statut === 'archived' ? ts(plusJours(q.envoyee, 60), '09:00') : 'null'});`);
  q.lignes.forEach((l, i) => {
    Q(`insert into public.quote_line_items (quote_id, org_id, source_service_id, name, quantity, unit_price_cents, sort_order) values ('${q.id}', ${O(q.bureau)}, ${l.service ? `'${SERVICES[l.service].id}'` : 'null'}, ${L(l.nom)}, ${l.qte}, ${l.prix}, ${i});`);
  });
}
Q(`insert into public.quote_sequences (org_id, last_value) values (${O('qc')}, ${Math.max(...jeu.soumissions.map((q) => +q.numero))});`);

// Jobs, lignes, visites, récurrences
for (const j of jeu.jobs) {
  const k = clientDe(j.client);
  const prop = j.propriete ?? (k.proprietes ?? [{ cle: 'principale' }])[0].cle;
  const v0 = j.visites[0];
  const equipe = j.bureau === 'qc' && v0 && ['tech1', 'tech2'].includes(v0.assigne) ? U('equipe.vitres') : 'null';
  Q(`insert into public.jobs (id, org_id, job_number, title, client_id, client_name, property_id, status, scheduled_at, start_at, end_at, completed_at, tax_cents, currency,
       team_id, assigned_user_id, expenses_cents, created_by, created_at, billing_mode, sale_date)
     values ('${j.id}', ${O(j.bureau)}, ${L(j.numero)}, ${L(j.titre)}, '${k.id}', ${L(nomClient(k))}, ${U(`propriete.${k.cle}.${prop}`)}, ${L(j.statut)},
       ${v0 ? ts(v0.jour, v0.debut) : 'null'}, ${v0 ? ts(v0.jour, v0.debut) : 'null'}, ${v0 ? ts(v0.jour, v0.fin) : 'null'}, ${j.termine ? ts(j.termine, v0?.fin ?? '16:00') : 'null'},
       ${j.tax}, 'CAD', ${equipe}, ${v0 ? UID(v0.assigne) : 'null'}, ${j.depenses ?? 0}, ${UID(proprioDe(j.bureau))},
       ${ts(v0 ? plusJours(v0.jour, -7) : cal.ceMois(1), '09:00')}, ${j.recurrence ? "'per_visit'" : "'single'"}, ${d(v0 ? v0.jour : cal.ancre)});`);
  j.lignes.forEach((l) => {
    Q(`insert into public.job_line_items (org_id, job_id, name, qty, unit_price_cents, created_by) values (${O(j.bureau)}, '${j.id}', ${L(l.nom)}, ${l.qte}, ${l.prix}, ${UID(proprioDe(j.bureau))});`);
  });
  j.visites.forEach((v, i) => {
    Q(`insert into public.schedule_events (id, org_id, job_id, title, start_at, end_at, assigned_user, team_id, timezone, created_by, status)
       values (${U(`visite.${j.cle}.${i}`)}, ${O(j.bureau)}, '${j.id}', ${L(j.titre)}, ${ts(v.jour, v.debut)}, ${ts(v.jour, v.fin)}, ${UID(v.assigne)}, ${equipe}, ${L(FUSEAU)}, ${UID(proprioDe(j.bureau))},
         ${L(j.statut === 'cancelled' ? 'cancelled' : (j.statut === 'completed' ? 'completed' : 'scheduled'))});`);
  });
  if (j.recurrence) {
    const dernier = j.visites[j.visites.length - 1].jour;
    Q(`insert into public.job_recurrence_rules (job_id, org_id, frequency, interval_days, day_of_month, start_date, next_run_at, is_active, timezone, local_time, occurrences_created)
       values ('${j.id}', ${O(j.bureau)}, ${L(j.recurrence.frequence)}, ${j.recurrence.frequence === 'biweekly' ? 14 : 30}, ${j.recurrence.jourDuMois ?? 'null'}, ${d(j.recurrence.debut)},
         ${ts(plusJours(dernier, j.recurrence.frequence === 'biweekly' ? 14 : 30), j.visites[0].debut)}, true, ${L(FUSEAU)}, ${L(j.visites[0].debut)}, ${j.visites.length});`);
  }
}
Q(`update public.quotes set job_id = ${U('job.isabelle_pression')} where id = ${U('soumission.isabelle')};`);

// Factures : brouillon + lignes (le trigger recalcule le total), puis émission, puis paiements.
for (const f of jeu.factures) {
  const k = clientDe(f.client);
  Q(`insert into public.invoices (id, org_id, created_by, client_id, job_id, invoice_number, status, subject, tax_cents, discount_cents, due_date, currency, created_at)
     values ('${f.id}', ${O(f.bureau)}, ${UID(proprioDe(f.bureau))}, '${k.id}', ${f.job ? U('job.' + f.job) : 'null'}, ${L(f.numero)}, 'draft', ${L(f.lignes.map((l) => l.nom).join(' + '))},
       ${f.tax}, 0, ${d(f.echeance)}, 'CAD', ${ts(f.emise ?? cal.ceMois(1), '08:00')});`);
  Q(`insert into public.invoice_items (org_id, invoice_id, description, title, qty, unit_price_cents, sort_order, source_type)
     values ${f.lignes.map((l, i) => `(${O(f.bureau)}, '${f.id}', ${L(l.nom)}, ${L(l.nom)}, ${l.qte}, ${l.prix}, ${i}, 'manual')`).join(', ')};`);
  if (!f.brouillon) {
    Q(`update public.invoices set issued_at = ${ts(f.emise, '08:00')}, sent_at = ${ts(f.emise, '08:05')} where id = '${f.id}';`);
  }
  if (f.annulee) Q(`update public.invoices set status = 'void' where id = '${f.id}';`);
  f.paiements.forEach((p, i) => {
    const stripe = p.methode === 'card' && f.cle === 'gite';
    Q(`insert into public.payments (id, org_id, created_by, invoice_id, job_id, client_id, amount_cents, paid_at, payment_date, method, status, provider, provider_payment_id, card_brand, card_last4)
       values (${U(`paiement.${f.cle}.${i}`)}, ${O(f.bureau)}, ${UID(proprioDe(f.bureau))}, '${f.id}', ${f.job ? U('job.' + f.job) : 'null'}, '${k.id}', ${p.montant},
         ${ts(p.jour, p.heure)}, ${ts(p.jour, p.heure)}, ${L(p.methode)}, 'succeeded', ${L(stripe ? 'stripe' : 'manual')}, ${stripe ? L('pi_TESTLUMI_gite') : 'null'},
         ${p.methode === 'card' ? L(k.carte?.marque ?? 'visa') : 'null'}, ${p.methode === 'card' ? L(k.carte?.quatre ?? '4242') : 'null'});`);
  });
}
for (const b of Object.keys(BUREAUX)) {
  const max = Math.max(...jeu.factures.filter((f) => f.bureau === b).map((f) => +f.numero));
  Q(`insert into public.invoice_sequences (org_id, last_value) values (${O(b)}, ${max}) on conflict (org_id) do update set last_value = excluded.last_value;
     insert into public.org_invoice_sequences (org_id, next_number) values (${O(b)}, ${max + 1}) on conflict (org_id) do update set next_number = excluded.next_number;`);
}
for (const r of jeu.facturesRecurrentes) {
  Q(`insert into public.recurring_invoice_schedules (id, org_id, client_id, subject, items, frequency, start_date, next_run_date, due_days_offset, auto_send, is_active)
     values ('${r.id}', ${O(r.bureau)}, '${clientDe(r.client).id}', ${L(r.sujet)}, ${L(r.lignes.map((l) => ({ description: l.nom, qty: l.qte, unit_price_cents: l.prix })))},
       ${L(r.frequence)}, ${d(r.debut)}, ${d(r.prochaine)}, ${r.delai}, ${L(r.envoiAuto)}, true);`);
}

// Feuilles de temps (sans pause : heures nettes = heures brutes) et paie
for (const e of jeu.entreesTemps) {
  const p = PERSONNES[e.personne];
  Q(`insert into public.time_entries (org_id, employee_id, employee_name, date, punch_in, punch_out, punch_in_at, punch_out_at, breaks, status, approved_by, approved_at, team_id, job_id)
     values (${O('qc')}, ${UID(e.personne)}, ${L(p.nomComplet)}, ${d(e.jour)}, ${L(e.debut + ':00')}, ${e.fin ? L(e.fin + ':00') : 'null'}, ${ts(e.jour, e.debut)}, ${e.fin ? ts(e.jour, e.fin) : 'null'},
       '[]'::jsonb, ${L(e.actif ? 'active' : 'completed')}, ${e.approuve ? UID('repartitrice') : 'null'}, ${e.approuve ? ts(plusJours(e.jour, 1), '09:00') : 'null'}, ${U('equipe.vitres')}, ${e.job ? U('job.' + e.job) : 'null'});`);
}
Q(`insert into public.payroll_settings (org_id, pay_period_type, anchor_date, pay_day_offset, timezone, created_by) values (${O('qc')}, 'biweekly', '2026-01-05', 5, ${L(FUSEAU)}, ${UID('proprio')});`);

// Tâches
for (const t of jeu.taches) {
  const [type, cle] = t.lien ?? [null, null];
  Q(`insert into public.tasks (id, org_id, title, status, priority, type, due_date, linked_entity_type, linked_entity_id, assignee_user_id, completed_at, created_by)
     values (${U('tache.' + t.cle)}, ${O('qc')}, ${L(t.titre)}, ${L(t.fait ? 'done' : 'open')}, ${L(t.priorite)}, 'Admin', ${d(t.echeance)}, ${L(type)}, ${cle ? U(cle) : 'null'},
       ${UID(t.assigne)}, ${t.fait ? ts(t.echeance, '15:00') : 'null'}, ${UID('proprio')});`);
}

// Notes
for (const n of jeu.notes) {
  const [type, cle] = n.entite;
  Q(`insert into public.specific_notes (org_id, entity_type, entity_id, text, created_by) values (${O('qc')}, ${L(type)}, ${U(cle)}, ${L(n.texte)}, ${UID(n.auteur)});`);
}

// Pipeline de ventes (deals) — étapes du modèle « nettoyage »
for (const dl of jeu.deals) {
  const etape = typeof dl.etape === 'number'
    ? `(select s.id from public.pipeline_stages s join public.pipelines_ventes p on p.id = s.pipeline_id where p.org_id = ${O('qc')} and p.is_default and s.position = ${dl.etape} limit 1)`
    : `(select s.id from public.pipeline_stages s join public.pipelines_ventes p on p.id = s.pipeline_id where p.org_id = ${O('qc')} and p.is_default and s.kind = ${L(dl.etape)} limit 1)`;
  Q(`insert into public.deals (id, org_id, pipeline_id, stage_id, client_id, assigned_user_id, assigned_at, source, quote_id, probability, expected_close_date, won_at, lost_at, lost_reason, created_by, created_at)
     values (${U('deal.' + dl.cle)}, ${O('qc')}, (select id from public.pipelines_ventes where org_id = ${O('qc')} and is_default limit 1), ${etape},
       '${clientDe(dl.client).id}', ${UID(dl.assigne)}, now(), ${L(dl.source)}, ${dl.soumission ? U('soumission.' + dl.soumission) : 'null'}, ${dl.probabilite ?? 'null'},
       ${d(dl.fermeture)}, ${dl.etape === 'won' ? ts(cal.J(-2), '15:00') : 'null'}, ${dl.etape === 'lost' ? ts(cal.J(-12), '12:00') : 'null'}, ${L(dl.raisonPerte ?? null)},
       ${UID('rep')}, ${ts(cal.J(-15), '09:00')});`);
}

// Conversations (textos) et courriels entrants
for (const cv of jeu.conversations) {
  const k = cv.client ? clientDe(cv.client) : null;
  Q(`insert into public.conversations (id, org_id, client_id, phone_number, client_name, unread_count, status) values
     (${U('conversation.' + cv.cle)}, ${O('qc')}, ${k ? `'${k.id}'` : 'null'}, ${L(cv.tel)}, ${L(k ? nomClient(k) : null)}, 0, 'active');`);
  for (const m of cv.messages) {
    Q(`insert into public.messages (conversation_id, org_id, client_id, phone_number, direction, message_text, status, sender_user_id, created_at)
       values (${U('conversation.' + cv.cle)}, ${O('qc')}, ${k ? `'${k.id}'` : 'null'}, ${L(cv.tel)}, ${L(m.sens)}, ${L(m.texte)}, ${L(m.sens === 'inbound' ? 'received' : 'delivered')},
         ${m.par ? UID(m.par) : 'null'}, ${L(m.quand)});`);
  }
  Q(`update public.conversations set unread_count = ${cv.nonLus} where id = ${U('conversation.' + cv.cle)};`);
}
for (const m of jeu.courrielsEntrants) {
  Q(`insert into public.communication_messages (org_id, client_id, channel_type, direction, provider, from_value, to_value, subject, body_text, status, created_at, delivered_at)
     values (${O('qc')}, ${m.client ? `'${clientDe(m.client).id}'` : 'null'}, 'email', 'inbound', 'resend', ${L(m.de)}, ${L(BUREAUX.qc.courriel)}, ${L(m.sujet)}, ${L(m.corps)}, 'received', ${L(m.quand)}, ${L(m.quand)});`);
}

// Formulaire public et ses demandes
Q(`insert into public.request_forms (id, org_id, created_by, title, description, enabled, pipeline_id)
   values ('${jeu.formulaire.id}', ${O('qc')}, ${UID('proprio')}, ${L(jeu.formulaire.titre)}, 'Formulaire du site web', true, (select id from public.pipelines_ventes where org_id = ${O('qc')} and is_default limit 1));`);
for (const s of jeu.soumissionsFormulaire) {
  Q(`insert into public.form_submissions (org_id, form_id, first_name, last_name, email, phone, street_address, city, region, country, postal_code, notes, client_id, lead_id, created_at)
     values (${O('qc')}, '${jeu.formulaire.id}', ${L(s.prenom)}, ${L(s.nom)}, ${L(s.courriel)}, ${L(s.tel)}, ${L(s.adresse)}, ${L(s.ville)}, 'QC', 'Canada', ${L(s.cp)}, ${L(s.notes)},
       ${s.client ? `'${clientDe(s.client).id}'` : 'null'}, ${s.client ? `'${clientDe(s.client).id}'` : 'null'}, ${L(s.quand)});`);
}

// Automatisations propres à l'entreprise (en plus du pack de base)
for (const a of jeu.automatisations) {
  Q(`insert into public.automation_rules (id, org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset)
     values (${U('automatisation.' + a.cle)}, ${O('qc')}, ${L(a.nom)}, ${L(a.nom)}, ${L(a.declencheur)}, '{}'::jsonb, ${a.delai}, ${L(a.actions)}, ${L(a.actif)}, false);`);
}

// Formation
for (const f of jeu.formations) {
  Q(`insert into public.courses (id, org_id, title, description, status, category, visibility, created_by, target_roles)
     values (${U('formation.' + f.cle)}, ${O('qc')}, ${L(f.titre)}, ${L(f.titre)}, ${L(f.statut)}, ${L(f.categorie)}, ${L(f.assignes.length ? 'assigned' : 'all')}, ${UID('proprio')}, '[]'::jsonb);`);
  f.modules.forEach((m, i) => {
    Q(`insert into public.course_modules (id, course_id, title, sort_order) values (${U(`formation.${f.cle}.module.${i}`)}, ${U('formation.' + f.cle)}, ${L(m.titre)}, ${i});`);
    m.lecons.forEach((l, j) => {
      Q(`insert into public.course_lessons (module_id, title, content_type, text_content, duration_min, sort_order) values (${U(`formation.${f.cle}.module.${i}`)}, ${L(l.titre)}, ${L(l.type)}, ${L(l.texte)}, ${l.minutes}, ${j});`);
    });
  });
  for (const qui of f.assignes) Q(`insert into public.course_assignments (course_id, user_id, assigned_by) values (${U('formation.' + f.cle)}, ${UID(qui)}, ${UID('proprio')});`);
}

// Modèles de courriel, objectif
for (const m of jeu.modelesCourriel) {
  Q(`insert into public.email_templates (org_id, created_by, name, type, subject, body, is_active) values (${O('qc')}, ${UID('proprio')}, ${L(m.nom)}, ${L(m.type)}, ${L(m.sujet)}, ${L(m.corps)}, true);`);
}
{
  const debut = cal.premierDuMois;
  const fin = plusJours({ y: debut.m === 12 ? debut.y + 1 : debut.y, m: debut.m === 12 ? 1 : debut.m + 1, d: 1 }, -1);
  Q(`insert into public.goals (org_id, created_by, metric, target_value, period, start_date, end_date) values (${O('qc')}, ${UID('proprio')}, 'revenue', ${jeu.objectifs.revenuMensuel}, 'monthly', ${d(debut)}, ${d(fin)});`);
}

// Envoi par paquets (l'API de gestion accepte de gros scripts, mais un échec doit pointer la bonne ligne).
const PAQUET = 60;
for (let i = 0; i < blocs.length; i += PAQUET) {
  try {
    await sql(blocs.slice(i, i + PAQUET).join('\n'));
  } catch (e) {
    // Retrouver l'instruction fautive pour un message utile.
    for (const b of blocs.slice(i, i + PAQUET)) {
      try { await sql(b); } catch (e2) { console.error(`\nÉCHEC sur :\n${b.slice(0, 900)}\n→ ${e2.message.slice(0, 600)}`); process.exit(1); }
    }
    throw e;
  }
}
console.log(`Données insérées (${blocs.length} instructions).`);

// ── 6. Vérification : les attendus du catalogue contre la base ───────────
const faits = calculerFaits(jeu, cal);
let erreurs = 0;
for (const v of verificationsSql(faits, jeu, cal)) {
  const [ligne] = await sql(v.sql);
  const obtenu = ligne ? Object.values(ligne)[0] : null;
  const ok = String(obtenu) === String(v.attendu);
  if (!ok) erreurs++;
  console.log(`  ${ok ? 'OK ' : 'ÉCART'} ${v.nom} : attendu ${v.attendu}, base ${obtenu}`);
}
if (erreurs) { console.error(`\n${erreurs} écart(s) entre le catalogue et la base.`); process.exit(1); }
console.log(`\nSeed terminé. Ancre du jour : ${iso(cal.ancre)}. Comptes : ${Object.values(PERSONNES).map((p) => p.courriel).join(', ')}`);
console.log(`Marqueur des données : « ${MARQUEUR} ».`);
try {
  const { readFileSync } = await import('node:fs');
  const cat = JSON.parse(readFileSync(new URL('../../../docs/audits/catalogue_taches_lumi.json', import.meta.url), 'utf8'));
  if (cat.ancre_exemple !== iso(cal.ancre)) {
    console.log(`\n⚠ Le catalogue versionné a l'ancre ${cat.ancre_exemple}, ce seed ${iso(cal.ancre)}. Pour évaluer aujourd'hui :`);
    console.log('  node supabase/seed/lumi-catalogue/generer-catalogue.mjs --sortie <dossier-temporaire>');
  }
} catch (e) {
  console.log(`(catalogue versionné illisible, ancre non comparée : ${e.message})`);
}
