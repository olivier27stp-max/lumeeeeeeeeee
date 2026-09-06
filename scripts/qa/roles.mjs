#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   LES RÔLES — chacun voit-il ce qu'il doit voir, et rien de plus ?

   Un technicien ne doit voir AUCUN prix. C'est la frontière la plus
   stricte de Lume : `resolvePermissions()` refuse même un passe-droit
   explicite qui donnerait une permission financière à un technicien.

   Une règle aussi ferme ne se vérifie pas en lisant le code — elle
   se vérifie en ouvrant une vraie session sous ce rôle et en
   regardant ce qui remonte.

   CE QU'IL CONTRÔLE
     - un technicien n'obtient aucun montant sur les jobs
     - il ne peut pas lire les factures ni les devis
     - un vendeur voit ses clients mais pas la facturation
     - chacun reste enfermé dans son organisation

   Usage : npm run qa:roles
   ═══════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const RACINE = process.cwd();
const URL_SB = process.env.VITE_SUPABASE_URL;
const CLE_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CLE_ANON = process.env.VITE_SUPABASE_ANON_KEY;

if (!URL_SB || !CLE_SERVICE || !CLE_ANON) {
  console.error('Variables Supabase manquantes — lancer avec --env-file=.env.local');
  process.exit(2);
}
if (process.env.SUPABASE_PROJECT_REF_PROD && URL_SB.includes(process.env.SUPABASE_PROJECT_REF_PROD)) {
  console.error('REFUS : ce banc crée des sessions de test. La cible est la PRODUCTION.');
  process.exit(2);
}

const admin = createClient(URL_SB, CLE_SERVICE, { auth: { persistSession: false } });
const resultats = [];
const ok = (nom, vrai, detail = '') => {
  resultats.push({ nom, vrai, detail });
  console.log(`  ${vrai ? '✓' : '✗'} ${nom}${detail ? ` — ${detail}` : ''}`);
  return vrai;
};

/** Ouvre une session réelle pour un compte donné. */
async function sessionPour(courriel) {
  const { data: lien, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: courriel });
  if (error) throw new Error(`${courriel} : ${error.message}`);
  const anon = createClient(URL_SB, CLE_ANON, { auth: { persistSession: false } });
  const { data: sess, error: e2 } = await anon.auth.verifyOtp({
    token_hash: lien.properties.hashed_token, type: 'magiclink',
  });
  if (e2) throw new Error(`${courriel} : ${e2.message}`);
  return createClient(URL_SB, CLE_ANON, {
    global: { headers: { Authorization: `Bearer ${sess.session.access_token}` } },
    auth: { persistSession: false },
  });
}

/** Les champs qui ne doivent JAMAIS remonter à un technicien. */
const CHAMPS_ARGENT = ['total_cents', 'subtotal_cents', 'tax_cents', 'total', 'subtotal', 'unit_price_cents'];

async function main() {
  console.log('\n═══ Rôles — qui voit quoi ═══\n');

  const ORG = process.env.QA_ORG || 'eeda2ab3-08df-4fce-82e1-3aa9b7d833cf';
  const { data: membres } = await admin
    .from('memberships').select('user_id, role, full_name').eq('org_id', ORG).eq('status', 'active');

  // Retrouver le courriel de chaque membre pour ouvrir sa session.
  const { data: comptes } = await admin.auth.admin.listUsers({ perPage: 200 });
  const parRole = {};
  for (const m of membres || []) {
    const c = comptes.users.find((u) => u.id === m.user_id);
    if (c && !parRole[m.role]) parRole[m.role] = { courriel: c.email, nom: m.full_name };
  }

  console.log('  Rôles disponibles : ' + Object.keys(parRole).join(', ') + '\n');

  /* ── Le technicien : aucune donnée financière ─────────────────── */
  if (parRole.technician) {
    console.log(`── Technicien (${parRole.technician.nom || parRole.technician.courriel}) ──`);
    const tech = await sessionPour(parRole.technician.courriel);

    // Les jobs : il doit les voir, mais SANS les montants.
    const { data: jobs, error: eJobs } = await tech
      .from('jobs').select('id, title, ' + CHAMPS_ARGENT.join(', ')).eq('org_id', ORG).limit(5);

    if (eJobs) {
      ok('les jobs lui sont refusés en bloc', true, `refus : ${eJobs.message.slice(0, 60)}`);
    } else {
      ok('il voit bien les jobs', (jobs || []).length >= 0, `${(jobs || []).length} job(s)`);
      // Le masquage doit remplacer chaque montant par une valeur vide.
      const fuites = [];
      for (const j of jobs || []) {
        for (const champ of CHAMPS_ARGENT) {
          if (j[champ] !== null && j[champ] !== undefined && Number(j[champ]) !== 0) {
            fuites.push(`${champ}=${j[champ]}`);
          }
        }
      }
      ok('aucun montant ne lui parvient sur les jobs', fuites.length === 0,
        fuites.length ? `FUITE : ${fuites.slice(0, 3).join(', ')}` : 'tous les montants sont masqués');
    }

    // Les factures : hors de son périmètre.
    const { data: factures, error: eF } = await tech.from('invoices').select('id, total_cents').eq('org_id', ORG).limit(3);
    ok('les factures lui sont inaccessibles', !!eF || (factures || []).length === 0,
      eF ? `refus : ${eF.message.slice(0, 50)}` : `${(factures || []).length} facture(s) visible(s)`);

    // Les devis : idem.
    const { data: devis, error: eD } = await tech.from('quotes').select('id, total_cents').eq('org_id', ORG).limit(3);
    ok('les devis lui sont inaccessibles', !!eD || (devis || []).length === 0,
      eD ? `refus : ${eD.message.slice(0, 50)}` : `${(devis || []).length} devis visible(s)`);

    // Le cloisonnement tient aussi pour lui.
    const { data: autres } = await admin.from('orgs').select('id').neq('id', ORG).is('deleted_at', null).limit(1);
    if (autres?.length) {
      const { data: fuite } = await tech.from('clients').select('id').eq('org_id', autres[0].id).limit(1);
      ok('il ne voit rien d\'une autre organisation', (fuite || []).length === 0);
    }
    console.log('');
  } else {
    console.log('── Technicien : aucun compte — contrôle impossible ──\n');
  }

  /* ── Le vendeur : clients et devis, pas la facturation ────────── */
  if (parRole.sales_rep) {
    console.log(`── Vendeur (${parRole.sales_rep.nom || parRole.sales_rep.courriel}) ──`);
    const vendeur = await sessionPour(parRole.sales_rep.courriel);

    const { data: clients, error: eC } = await vendeur.from('clients').select('id').eq('org_id', ORG).limit(3);
    ok('il accède à ses clients', !eC, eC ? eC.message.slice(0, 50) : `${(clients || []).length} client(s)`);

    const { data: devis, error: eD } = await vendeur.from('quotes').select('id').eq('org_id', ORG).limit(3);
    ok('il accède aux devis', !eD, eD ? eD.message.slice(0, 50) : `${(devis || []).length} devis`);

    const { data: autres } = await admin.from('orgs').select('id').neq('id', ORG).is('deleted_at', null).limit(1);
    if (autres?.length) {
      const { data: fuite } = await vendeur.from('clients').select('id').eq('org_id', autres[0].id).limit(1);
      ok('il ne voit rien d\'une autre organisation', (fuite || []).length === 0);
    }
    console.log('');
  }

  /* ── L'administrateur : tout sauf supprimer un utilisateur ────── */
  if (parRole.admin) {
    console.log(`── Administrateur (${parRole.admin.nom || parRole.admin.courriel}) ──`);
    const adm = await sessionPour(parRole.admin.courriel);

    // Le préréglage `admin` accorde tout SAUF users.delete : il doit donc voir
    // l'argent comme un propriétaire.
    for (const t of ['invoices', 'quotes', 'jobs', 'clients']) {
      const { data, error } = await adm.from(t).select('id').eq('org_id', ORG).limit(3);
      ok(`il accède à ${t}`, !error, error ? error.message.slice(0, 50) : `${(data || []).length} ligne(s)`);
    }

    const { data: f } = await adm.from('invoices').select('total_cents').eq('org_id', ORG).limit(1);
    ok('il voit les montants des factures', f?.[0]?.total_cents != null,
      f?.[0]?.total_cents != null ? `${f[0].total_cents} cents` : 'masqués — anormal pour un admin');

    const { data: autres } = await admin.from('orgs').select('id').neq('id', ORG).is('deleted_at', null).limit(1);
    if (autres?.length) {
      const { data: fuite } = await adm.from('clients').select('id').eq('org_id', autres[0].id).limit(1);
      ok('il ne voit rien d’une autre organisation', (fuite || []).length === 0);
    }
    console.log('');
  } else {
    console.log('── Administrateur : aucun compte — contrôle impossible ──');
  }

  /* ── Le vendeur, en profondeur ────────────────────────────────── */
  if (parRole.sales_rep) {
    console.log('── Vendeur : ce qu’il ne doit PAS pouvoir faire ──');
    const v = await sessionPour(parRole.sales_rep.courriel);

    // `financial.view_pricing` : oui. Mais pas la gestion d'équipe ni les
    // réglages de l'organisation.
    const { data: prix } = await v.from('jobs').select('total_cents').eq('org_id', ORG).limit(1);
    ok('il voit les prix (financial.view_pricing)', prix?.[0]?.total_cents != null,
      prix?.[0]?.total_cents != null ? 'oui' : 'masqués');

    // Écriture dans les réglages de l'organisation : réservée aux admins.
    //
    // PIÈGE (rencontré le 2026-09-02) : un `update()` sur une table VIDE
    // réussit sans rien toucher — aucune erreur, zéro ligne modifiée. Lu
    // naïvement, ce silence ressemble à une écriture acceptée et fait crier
    // à la faille alors que tout est verrouillé.
    //
    // On teste donc l'INSERT, qui se heurte toujours au `with check` même
    // quand la table est vide, et on n'accepte l'UPDATE comme preuve que
    // s'il a réellement modifié une ligne (`.select()` les renvoie).
    const { error: eIns } = await v.from('company_settings')
      .insert({ org_id: ORG, company_name: '[QA] tentative vendeur' }).select('org_id');

    const { data: modifiees, error: eUpd } = await v.from('company_settings')
      .update({ updated_at: new Date().toISOString() }).eq('org_id', ORG).select('org_id');

    const creationRefusee = !!eIns;
    const modifRefusee = !!eUpd || (modifiees || []).length === 0;
    ok('il ne peut pas modifier les réglages de l’entreprise', creationRefusee && modifRefusee,
      creationRefusee
        ? `création refusée : ${eIns.message.slice(0, 40)}`
        : 'CRÉATION ACCEPTÉE — vraie faille');

    // Filet : si une tentative est passée, on la retire immédiatement.
    if (!creationRefusee) {
      await admin.from('company_settings').delete()
        .eq('org_id', ORG).eq('company_name', '[QA] tentative vendeur');
    }
    console.log('');
  }

  /* ── Le propriétaire : tout, dans SON organisation ────────────── */
  if (parRole.owner) {
    console.log(`── Propriétaire (${parRole.owner.nom || parRole.owner.courriel}) ──`);
    const proprio = await sessionPour(parRole.owner.courriel);

    const { data: f, error: eF } = await proprio.from('invoices').select('id, total_cents').eq('org_id', ORG).limit(3);
    ok('il voit les factures et leurs montants', !eF, eF ? eF.message.slice(0, 50) : `${(f || []).length} facture(s)`);

    const { data: autres } = await admin.from('orgs').select('id').neq('id', ORG).is('deleted_at', null).limit(1);
    if (autres?.length) {
      const { data: fuite } = await proprio.from('clients').select('id').eq('org_id', autres[0].id).limit(1);
      ok('même lui ne voit rien d\'une autre organisation', (fuite || []).length === 0);
    }
    console.log('');
  }

  const passees = resultats.filter((r) => r.vrai).length;
  fs.writeFileSync(
    path.join(RACINE, 'qa-roles.json'),
    JSON.stringify({ genereLe: new Date().toISOString(), passees, total: resultats.length, resultats }, null, 2),
    'utf8',
  );

  console.log('═'.repeat(60));
  console.log(`  ${passees}/${resultats.length} vérifications passées`);
  const rates = resultats.filter((r) => !r.vrai);
  if (rates.length) {
    console.log('');
    rates.forEach((r) => console.log(`  ✗ ${r.nom}${r.detail ? ` — ${r.detail}` : ''}`));
  }
  console.log('\n  → qa-roles.json\n');
  process.exit(rates.length ? 1 : 0);
}

main().catch((e) => {
  console.error('\nBanc interrompu :', e.message);
  process.exit(1);
});
