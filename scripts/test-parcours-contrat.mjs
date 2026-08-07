#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   Banc d'essai — le parcours client de bout en bout, sur STAGING.

   Rejoue ce qu'un client vit vraiment :
     1. une job est créée avec un rendez-vous  → la confirmation part-elle ?
     2. le contrat s'affiche                    → l'entreprise est-elle dessus ?
     3. le client signe                         → un dépôt est-il réclamé ?
     4. il veut payer                           → l'encaissement répond-il ?
     5. le message de confirmation              → le lien du contrat y est-il ?

   Aucun SMS n'est envoyé : le serveur doit tourner SANS identifiants
   Twilio (voir l'en-tête de la commande plus bas), donc l'action
   d'envoi échoue volontairement — ce qui suffit, car ce qu'on vérifie
   c'est que le moteur se déclenche et résout bien ses variables.

   Usage :
     node --env-file=.env.local scripts/test-parcours-contrat.mjs [url]
   (url par défaut : http://localhost:3013)
   ═══════════════════════════════════════════════════════════════ */

import { createClient } from '@supabase/supabase-js';

const BASE = process.argv[2] || 'http://localhost:3013';
const URL_SB = process.env.VITE_SUPABASE_URL;
const CLE_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CLE_ANON = process.env.VITE_SUPABASE_ANON_KEY;

if (!URL_SB || !CLE_SERVICE || !CLE_ANON) {
  console.error('Variables Supabase manquantes — lancer avec --env-file=.env.local');
  process.exit(1);
}
// Garde-fou : ce script ÉCRIT. Il ne doit jamais viser la production.
if (process.env.SUPABASE_PROJECT_REF_PROD && URL_SB.includes(process.env.SUPABASE_PROJECT_REF_PROD)) {
  console.error('REFUS : ce banc d\'essai écrit des données. La cible est la PRODUCTION.');
  process.exit(1);
}

const admin = createClient(URL_SB, CLE_SERVICE, { auth: { persistSession: false } });

const MARQUE = 'BANC-ESSAI-PARCOURS';
const resultats = [];
const ok = (nom, vrai, detail = '') => {
  resultats.push({ nom, vrai, detail });
  console.log(`  ${vrai ? '✓' : '✗'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

async function main() {
  console.log(`Cible : ${URL_SB.replace(/https:\/\/([^.]+).*/, '$1')} via ${BASE}\n`);

  // ── Décor ────────────────────────────────────────────────────────
  const { data: org } = await admin.from('orgs').select('id').limit(1).maybeSingle();
  if (!org) throw new Error('Aucune org sur cette base.');
  const orgId = org.id;

  // L'utilisateur d'abord : un déclencheur exige created_by quand l'écriture
  // ne vient pas d'une session — sans lui, tout le décor échoue.
  const courriel = `banc-essai-${Date.now().toString(36)}@example.invalid`;
  const motDePasse = 'BancEssai1234!';
  const { data: cree, error: eUser } = await admin.auth.admin.createUser({
    email: courriel, password: motDePasse, email_confirm: true,
  });
  if (eUser) throw new Error(`création de l'utilisateur : ${eUser.message}`);
  const uid = cree.user.id;
  const { error: eMemb } = await admin.from('memberships')
    .insert({ org_id: orgId, user_id: uid, role: 'owner', status: 'active', full_name: 'Banc Essai' });
  if (eMemb) throw new Error(`adhésion : ${eMemb.message}`);

  const anon = createClient(URL_SB, CLE_ANON, { auth: { persistSession: false } });
  const { data: session, error: eSess } = await anon.auth.signInWithPassword({ email: courriel, password: motDePasse });
  if (eSess) throw new Error(`connexion : ${eSess.message}`);
  const jeton = session?.session?.access_token;

  const { error: eCs } = await admin.from('company_settings').upsert(
    { org_id: orgId, company_name: 'Coquin lavage', phone: '819-555-0100', city: 'Drummondville',
      street1: '760 rue Test', created_by: uid },
    { onConflict: 'org_id' },
  );
  if (eCs) throw new Error(`réglages entreprise : ${eCs.message}`);

  // Numéro volontairement invalide : même si un envoi passait, il échouerait.
  const { data: client, error: eCli } = await admin
    .from('clients')
    .insert({ org_id: orgId, first_name: 'Banc', last_name: MARQUE, phone: '+15005550001',
              email: 'banc@example.invalid', created_by: uid })
    .select('id')
    .single();
  if (eCli) throw new Error(`client : ${eCli.message}`);

  const demain = new Date(Date.now() + 86400000);
  demain.setHours(14, 0, 0, 0);

  const { data: job, error: eJob } = await admin
    .from('jobs')
    .insert({
      org_id: orgId, title: MARQUE, client_id: client.id, subtotal_cents: 100000,
      tax_lines: [{ label: 'TPS', rate: 5, enabled: true }, { label: 'TVQ', rate: 9.975, enabled: true }],
      deposit_required: true, deposit_type: 'percentage', deposit_value: 30, deposit_status: 'pending',
      property_address: "760 rue de l'apothicaire, Drummondville", currency: 'CAD', status: 'scheduled',
      scheduled_at: demain.toISOString(), created_by: uid,
    })
    .select('id')
    .single();
  if (eJob) throw new Error(`job : ${eJob.message}`);

  const { data: contrat, error: eCtr } = await admin
    .from('job_agreements')
    .insert({ org_id: orgId, job_id: job.id, client_id: client.id, require_signature: true,
              terms: MARQUE, status: 'sent', created_by: uid })
    .select('id, view_token')
    .single();
  if (eCtr) throw new Error(`contrat : ${eCtr.message}`);

  const nettoyer = async () => {
    await admin.from('automation_execution_logs').delete().eq('entity_id', job.id);
    await admin.from('payment_requirements').delete().eq('entity_id', job.id);
    await admin.from('schedule_events').delete().eq('job_id', job.id);
    await admin.from('job_agreements').delete().eq('job_id', job.id);
    await admin.from('jobs').delete().eq('id', job.id);
    await admin.from('memberships').delete().eq('user_id', uid);
    await admin.from('clients').delete().eq('id', client.id);
    await admin.auth.admin.deleteUser(uid);
  };

  try {
    // ── 1. La confirmation de rendez-vous part-elle ? ───────────────
    console.log('1. Rendez-vous créé comme le fait le mobile');
    const { data: rdv, error: eRdv } = await admin
      .from('schedule_events')
      .insert({
        org_id: orgId, job_id: job.id, start_at: demain.toISOString(),
        end_at: new Date(demain.getTime() + 7200000).toISOString(),
        start_time: demain.toISOString(), end_time: new Date(demain.getTime() + 7200000).toISOString(),
        status: 'scheduled', created_by: uid,
      })
      .select('id')
      .single();
    if (eRdv) throw new Error(`rendez-vous : ${eRdv.message}`);

    ok('session de test obtenue', !!jeton);

    const rep = await fetch(`${BASE}/api/automations/events/appointment-created`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jeton}`, 'x-org-id': orgId },
      body: JSON.stringify({ eventId: rdv.id, jobId: job.id, clientId: client.id, startTime: demain.toISOString() }),
    });
    ok('le moteur accepte la notification', rep.ok, `http ${rep.status}`);

    // Le moteur travaille de façon asynchrone : on laisse le temps d'écrire.
    await new Promise((r) => setTimeout(r, 4000));
    const { data: journaux } = await admin
      .from('automation_execution_logs')
      .select('action_type, result_success, result_error')
      .eq('entity_id', rdv.id);
    ok(
      'la règle « confirmation de rendez-vous » se déclenche',
      (journaux ?? []).length > 0,
      `${(journaux ?? []).length} action(s) : ${(journaux ?? []).map((j) => j.action_type).join(', ') || 'aucune'}`,
    );

    // ── 1b. Ce que le message contient VRAIMENT ─────────────────────
    // La confirmation part à la création du rendez-vous, donc avant que le
    // client ait signé : c'est là que le lien du contrat doit y être.
    const { resolveEntityVariables, resolveTemplate } = await import('../server/lib/actions/index.ts');
    const { data: regle } = await admin
      .from('automation_rules').select('actions')
      .eq('org_id', orgId).eq('preset_key', 'appointment_confirmation').maybeSingle();
    const gabarit = (regle?.actions ?? []).find((a) => a.type === 'send_sms')?.config?.body ?? '';
    const varsAvant = await resolveEntityVariables(admin, orgId, 'schedule_event', rdv.id);
    const corpsAvant = resolveTemplate(gabarit, varsAvant);
    ok('la date du rendez-vous est dans le message', corpsAvant.includes(varsAvant.appointment_date || '\u0000'), varsAvant.appointment_date);
    ok('le lien du contrat est dans le message', corpsAvant.includes('/contract/'),
       corpsAvant.includes('/contract/') ? 'présent' : 'ABSENT');
    console.log('\n  ── message tel qu\'il partirait ──\n' + corpsAvant.split('\n').map((l) => '  ' + l).join('\n') + '\n');

    // ── 2. La page publique du contrat ──────────────────────────────
    console.log('\n2. Page publique du contrat');
    const vue = await fetch(`${BASE}/api/agreements/public/${contrat.view_token}`).then((r) => r.json());
    ok('le nom de l\'entreprise s\'affiche', vue?.company?.name === 'Coquin lavage', String(vue?.company?.name));
    ok('l\'adresse s\'affiche', !!vue?.company?.address, String(vue?.company?.address));
    ok('le dépôt figure au contrat', vue?.doc?.payment_terms?.deposit_required === true,
       `${(vue?.doc?.payment_terms?.deposit_cents ?? 0) / 100} $`);

    // ── 3. Signature ────────────────────────────────────────────────
    console.log('\n3. Le client signe');
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const sig = await fetch(`${BASE}/api/agreements/public/sign`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ view_token: contrat.view_token, signer_name: 'Banc Essai', signature_data: png }),
    });
    const sigJson = await sig.json();
    ok('la signature est acceptée', sig.ok, `http ${sig.status}`);
    ok('le dépôt est réclamé aussitôt', sigJson?.deposit_due === true, `${(sigJson?.deposit_cents ?? 0) / 100} $`);

    // La confirmation de signature : le client reçoit-il sa copie ?
    await new Promise((r) => setTimeout(r, 4000));
    const { data: jSig } = await admin
      .from('automation_execution_logs')
      .select('action_type')
      .eq('entity_id', job.id)
      .eq('trigger_event', 'agreement.signed');
    ok('la règle « contrat signé » se déclenche', (jSig ?? []).length > 0,
       `${(jSig ?? []).length} action(s) : ${(jSig ?? []).map((j) => j.action_type).join(', ') || 'aucune'}`);

    const { data: regleSig } = await admin
      .from('automation_rules').select('actions')
      .eq('org_id', orgId).eq('preset_key', 'agreement_signed').maybeSingle();
    const gabaritSig = (regleSig?.actions ?? []).find((a) => a.type === 'send_sms')?.config?.body ?? '';
    const varsSig = await resolveEntityVariables(admin, orgId, 'job', job.id);
    const corpsSig = resolveTemplate(gabaritSig, varsSig);
    ok('la copie signée est dans le message', corpsSig.includes('/contract/'));
    ok('le dépôt restant est annoncé', corpsSig.includes('344,93') || corpsSig.includes('344.93'),
       varsSig.deposit_amount || 'absent');
    console.log('\n  ── message de signature ──\n' + corpsSig.split('\n').map((l) => '  ' + l).join('\n') + '\n');

    const varsApres = await resolveEntityVariables(admin, orgId, 'schedule_event', rdv.id);
    const corpsApres = resolveTemplate(gabarit, varsApres);
    ok('le lien disparaît une fois le contrat signé', !corpsApres.includes('/contract/'),
       corpsApres.includes('/contract/') ? 'encore là' : 'effacé');

    // ── 4. Paiement ─────────────────────────────────────────────────
    console.log('\n4. Le client veut payer');
    const pay = await fetch(`${BASE}/api/agreements/public/deposit-intent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ view_token: contrat.view_token }),
    });
    const payJson = await pay.json();
    // 503 = aucun fournisseur branché sur cette org. C'est le bon refus :
    // il prouve que tout le chemin a été parcouru jusqu'à l'encaissement.
    ok('l\'encaissement répond', pay.ok || pay.status === 503,
       pay.ok ? 'intention créée' : `refus attendu : ${payJson?.error?.slice(0, 60)}`);
    const { data: exigence } = await admin
      .from('payment_requirements').select('amount_cents, status').eq('entity_id', job.id).maybeSingle();
    ok('le dépôt dû est inscrit au dossier', !!exigence,
       exigence ? `${exigence.amount_cents / 100} $ (${exigence.status})` : 'absent');

    const faux = await fetch(`${BASE}/api/agreements/public/deposit-confirm`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ view_token: contrat.view_token, payment_intent_id: 'pi_bidon_000' }),
    });
    ok('un paiement inventé est refusé', !faux.ok, `http ${faux.status}`);

  } finally {
    await nettoyer();
  }

  const echecs = resultats.filter((r) => !r.vrai);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérifications passées.`);
  if (echecs.length) {
    console.log('Échecs : ' + echecs.map((e) => e.nom).join(' · '));
    process.exit(1);
  }
}

main().catch((e) => { console.error('\nBanc d\'essai interrompu :', e.message); process.exit(1); });
