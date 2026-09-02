#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   LE PARCOURS — le robot fait le travail d'un vrai utilisateur.

   Visiter des pages ne suffit pas : la moitié de l'application ne
   se révèle qu'en CRÉANT des choses. Un formulaire qui dit
   « enregistré » sans rien enregistrer, un champ qui se vide au
   rechargement, un total qui ne correspond pas aux lignes — rien
   de tout ça ne se voit en lecture seule.

   CE QU'IL FAIT, DANS L'ORDRE D'UN VRAI DOSSIER
     1. crée un client
     2. lui fait un devis
     3. vérifie que le devis apparaît chez le client
     4. crée un job
     5. facture
     6. contrôle que les montants concordent avec la base

   À CHAQUE ÉTAPE il RECHARGE et revérifie : c'est le seul moyen
   d'attraper un enregistrement qui n'a pas eu lieu.

   Tout est préfixé [QA] et rangé à la fin — sauf ce qui a posé
   problème, gardé comme pièce à conviction.

   Usage : npm run qa:parcours
   ═══════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const RACINE = process.cwd();
const URL_SB = process.env.VITE_SUPABASE_URL;
const CLE_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CLE_ANON = process.env.VITE_SUPABASE_ANON_KEY;
const COMPTE = process.env.QA_COMPTE || 'willhebert30@gmail.com';

if (!URL_SB || !CLE_SERVICE || !CLE_ANON) {
  console.error('Variables Supabase manquantes — lancer avec --env-file=.env.local');
  process.exit(2);
}

// Ce banc ÉCRIT. Il ne doit jamais viser la production sans le filet.
if (process.env.SUPABASE_PROJECT_REF_PROD && URL_SB.includes(process.env.SUPABASE_PROJECT_REF_PROD)) {
  console.error('REFUS : ce parcours écrit des données. La cible est la PRODUCTION.');
  process.exit(2);
}

const admin = createClient(URL_SB, CLE_SERVICE, { auth: { persistSession: false } });

const MARQUE = '[QA]';
const resultats = [];
const aGarder = [];

const ok = (nom, vrai, detail = '') => {
  resultats.push({ nom, vrai, detail });
  console.log(`  ${vrai ? '✓' : '✗'} ${nom}${detail ? ` — ${detail}` : ''}`);
  return vrai;
};

/** Relit depuis la base : la seule preuve qu'un enregistrement a eu lieu. */
async function relire(table, id, colonnes = '*') {
  const { data } = await admin.from(table).select(colonnes).eq('id', id).maybeSingle();
  return data;
}

async function main() {
  console.log('\n═══ Parcours complet — création → devis → job → facture ═══\n');

  // Session utilisateur réelle : on écrit comme l'application le ferait,
  // à travers les mêmes règles d'accès.
  const { data: lien } = await admin.auth.admin.generateLink({ type: 'magiclink', email: COMPTE });
  const anon = createClient(URL_SB, CLE_ANON, { auth: { persistSession: false } });
  const { data: sess } = await anon.auth.verifyOtp({
    token_hash: lien.properties.hashed_token, type: 'magiclink',
  });
  const jeton = sess.session.access_token;
  const utilisateur = sess.session.user.id;

  const { data: membre } = await admin
    .from('memberships').select('org_id').eq('user_id', utilisateur)
    .eq('status', 'active').limit(1).maybeSingle();
  if (!membre) throw new Error(`aucune organisation active pour ${COMPTE}`);
  const orgId = membre.org_id;

  // Client agissant SOUS LES RÈGLES D'ACCÈS, comme le navigateur.
  const user = createClient(URL_SB, CLE_ANON, {
    global: { headers: { Authorization: `Bearer ${jeton}` } },
    auth: { persistSession: false },
  });

  console.log(`  Organisation : ${orgId}\n`);
  const suffixe = Date.now().toString(36);
  const cree = { client: null, devis: null, job: null, facture: null };

  try {
    /* ── 1. Le client ──────────────────────────────────────────── */
    console.log('1. Création d\'un client');
    const { data: client, error: eClient } = await user
      .from('clients')
      .insert({
        org_id: orgId,
        first_name: `${MARQUE} Parcours`,
        last_name: suffixe,
        email: `qa-${suffixe}@exemple.invalid`,
        phone: '+15005550006',
        status: 'lead',
      })
      .select('id, first_name, last_name, email, status')
      .single();

    if (!ok('le client est créé', !eClient && !!client, eClient?.message || `id ${client?.id?.slice(0, 8)}`)) {
      throw new Error('sans client, la suite n\'a pas de sens');
    }
    cree.client = client.id;

    // Relecture : « créé » ne veut rien dire tant qu'on ne l'a pas relu.
    const relu = await relire('clients', client.id, 'first_name, last_name, email, status, org_id');
    ok('il est bien enregistré', !!relu, relu ? `${relu.first_name} ${relu.last_name}` : 'introuvable après création');
    ok('ses champs ont été conservés', relu?.email === client.email, relu?.email || 'courriel perdu');
    ok('il appartient à la bonne organisation', relu?.org_id === orgId);

    /* ── 2. Le devis ───────────────────────────────────────────── */
    console.log('\n2. Devis pour ce client');
    // On emprunte le MÊME chemin que l'application : `rpc_create_quote`.
    // Une insertion directe échoue — `quotes.quote_number` est obligatoire et
    // sans valeur par défaut, c'est la fonction qui attribue le numéro. Passer
    // à côté testerait un chemin que personne n'emprunte.
    const { data: creation, error: eDevis } = await user.rpc('rpc_create_quote', {
      p_lead_id: null,
      p_client_id: client.id,
      p_title: `${MARQUE} Devis ${suffixe}`,
      p_salesperson_id: utilisateur,
      p_context_type: 'client',
      p_currency: 'CAD',
      p_valid_days: 30,
      p_notes: null,
      p_contract: null,
      p_deposit_required: false,
      p_require_payment_method: false,
    });

    const devisId = creation?.quote_id ? String(creation.quote_id) : null;
    ok('le devis est créé', !eDevis && !!devisId, eDevis?.message || `id ${devisId?.slice(0, 8)}`);

    const devis = devisId ? await relire('quotes', devisId, 'id, title, status, client_id, quote_number') : null;
    if (devis) {
      cree.devis = devis.id;
      ok('il reçoit un numéro', !!devis.quote_number, devis.quote_number || 'AUCUN NUMÉRO');
      ok('il est rattaché au bon client', devis.client_id === client.id);

      ok('il est bien enregistré', !!devis.title, devis.title || 'sans titre');

      // Le devis apparaît-il quand on liste ceux du client ? C'est la
      // question que se pose l'utilisateur en ouvrant sa fiche.
      const { data: liste } = await user
        .from('quotes').select('id').eq('client_id', client.id).is('deleted_at', null);
      ok('il apparaît dans les devis du client', (liste || []).some((q) => q.id === devis.id),
        `${(liste || []).length} devis trouvé(s)`);
    }

    /* ── 3. Le job ─────────────────────────────────────────────── */
    console.log('\n3. Job pour ce client');
    const { data: job, error: eJob } = await user
      .from('jobs')
      .insert({
        org_id: orgId,
        client_id: client.id,
        title: `${MARQUE} Job ${suffixe}`,
        status: 'scheduled',
        scheduled_at: new Date(Date.now() + 86400000).toISOString(),
        subtotal_cents: 25000,
        tax_cents: 3744,
        total_cents: 28744,
      })
      .select('id, title, status, total_cents, subtotal_cents')
      .single();

    ok('le job est créé', !eJob && !!job, eJob?.message || `« ${job?.title} »`);
    if (job) {
      cree.job = job.id;
      const jobRelu = await relire('jobs', job.id, 'total_cents, subtotal_cents, total, subtotal, status');
      ok('il est bien enregistré', !!jobRelu);

      // Les montants : *_cents fait foi, les colonnes héritées sont des
      // projections recalculées par déclencheur. Si elles divergent, les
      // écrans qui les lisent afficheront un faux total.
      if (jobRelu) {
        const attenduTotal = Number(jobRelu.total_cents) / 100;
        ok('le total en dollars suit les cents',
          Math.abs(Number(jobRelu.total) - attenduTotal) < 0.011,
          `${jobRelu.total} $ pour ${jobRelu.total_cents} cents`);

        const attenduSousTotal = Number(jobRelu.subtotal_cents) / 100;
        ok('le sous-total en dollars suit les cents',
          Math.abs(Number(jobRelu.subtotal) - attenduSousTotal) < 0.011,
          `${jobRelu.subtotal} $ pour ${jobRelu.subtotal_cents} cents`);
      }

      // Créer un job doit faire passer le client de « prospect » à « actif ».
      await new Promise((r) => setTimeout(r, 1500));
      const clientApres = await relire('clients', client.id, 'status');
      ok('le client passe de prospect à actif', clientApres?.status === 'active',
        `statut : ${clientApres?.status}`);
    }

    /* ── 4. La facture ─────────────────────────────────────────── */
    console.log('\n4. Facture');
    const { data: facture, error: eFacture } = await user
      .from('invoices')
      .insert({
        org_id: orgId,
        client_id: client.id,
        job_id: cree.job,
        subject: `${MARQUE} Facture ${suffixe}`,
        status: 'draft',
        subtotal_cents: 25000,
        tax_cents: 3744,
        total_cents: 28744,
      })
      .select('id, subject, invoice_number, total_cents')
      .single();

    ok('la facture est créée', !eFacture && !!facture, eFacture?.message || `n° ${facture?.invoice_number ?? '—'}`);
    if (facture) {
      cree.facture = facture.id;
      const f = await relire('invoices', facture.id, 'invoice_number, total_cents, total, status, client_id');
      ok('elle est bien enregistrée', !!f);
      ok('elle porte un numéro', !!f?.invoice_number, String(f?.invoice_number ?? 'AUCUN'));
      if (f) {
        ok('son total en dollars suit les cents',
          Math.abs(Number(f.total) - Number(f.total_cents) / 100) < 0.011,
          `${f.total} $ pour ${f.total_cents} cents`);
      }
    }

    /* ── 5. Isolation ──────────────────────────────────────────── */
    console.log('\n5. Cloisonnement entre organisations');
    const { data: autres } = await admin
      .from('orgs').select('id').neq('id', orgId).is('deleted_at', null).limit(1);
    if (autres?.length) {
      const { data: fuite } = await user
        .from('clients').select('id').eq('org_id', autres[0].id).limit(1);
      ok('aucune donnée d\'une autre organisation n\'est lisible', (fuite || []).length === 0,
        `${(fuite || []).length} ligne(s) visible(s)`);
    } else {
      console.log('  · une seule organisation en base — rien à cloisonner');
    }
  } finally {
    /* ── Rangement ─────────────────────────────────────────────── */
    console.log('\n6. Rangement');
    const echecs = resultats.filter((r) => !r.vrai).length;

    if (echecs > 0) {
      // Décision du propriétaire : garder ce qui a posé problème.
      for (const [quoi, id] of Object.entries(cree)) if (id) aGarder.push(`${quoi} ${id}`);
      console.log(`  · ${aGarder.length} objet(s) CONSERVÉ(S) comme pièces à conviction :`);
      aGarder.forEach((x) => console.log(`      ${x}`));
    } else {
      // Mise de côté, jamais d'effacement : c'est la règle du projet.
      const maintenant = new Date().toISOString();
      for (const [table, id] of [['invoices', cree.facture], ['jobs', cree.job], ['quotes', cree.devis], ['clients', cree.client]]) {
        if (!id) continue;
        await admin.from(table).update({ deleted_at: maintenant }).eq('id', id);
      }
      console.log('  · tout est rangé (mis de côté, rien n\'est effacé)');
    }
  }

  /* ── Verdict ─────────────────────────────────────────────────── */
  const passees = resultats.filter((r) => r.vrai).length;
  const total = resultats.length;

  fs.writeFileSync(
    path.join(RACINE, 'qa-parcours.json'),
    JSON.stringify({ genereLe: new Date().toISOString(), passees, total, resultats, conserves: aGarder }, null, 2),
    'utf8',
  );

  console.log('\n' + '═'.repeat(60));
  console.log(`  ${passees}/${total} vérifications passées`);
  const rates = resultats.filter((r) => !r.vrai);
  if (rates.length) {
    console.log('');
    rates.forEach((r) => console.log(`  ✗ ${r.nom}${r.detail ? ` — ${r.detail}` : ''}`));
  }
  console.log('\n  → qa-parcours.json\n');
  process.exit(rates.length ? 1 : 0);
}

main().catch((e) => {
  console.error('\nParcours interrompu :', e.message);
  process.exit(1);
});
