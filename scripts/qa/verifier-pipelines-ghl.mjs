// Usage : node --env-file=.env.local scripts/qa/verifier-pipelines-ghl.mjs
// Rejoue la mission « Pipelines façon GHL » contre STAGING (refuse la prod).
// Crée ses propres données (préfixe ZZSonde) et les supprime à la fin.

// STAGING — le scénario complet de la mission « Pipelines façon GHL », joué
// avec de VRAIS comptes connectés (même chemin que l'app : PostgREST + RLS).
// Tout ce qui est créé est noté et supprimé à la fin, même en cas d'échec.
import { createClient } from '@supabase/supabase-js';
const URL = process.env.VITE_SUPABASE_URL, ANON = process.env.VITE_SUPABASE_ANON_KEY, SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (process.env.SUPABASE_PROJECT_REF === process.env.SUPABASE_PROJECT_REF_PROD) throw new Error('prod refusée');
const admin = createClient(URL, SR, { auth: { persistSession: false } });

async function session(userId, orgId) {
  const { data: u } = await admin.auth.admin.getUserById(userId);
  const { data: lien } = await admin.auth.admin.generateLink({ type: 'magiclink', email: u.user.email });
  const { data: s } = await createClient(URL, ANON, { auth: { persistSession: false } })
    .auth.verifyOtp({ type: 'magiclink', token_hash: lien.properties.hashed_token });
  return createClient(URL, ANON, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${s.session.access_token}`, 'x-lume-org': orgId } },
  });
}

const { data: org } = await admin.from('orgs').select('id').eq('name', 'Vision Lavage').single();
const { data: autreOrg } = await admin.from('orgs').select('id,name').like('name', 'e2e-%orgb').limit(1).single();
const { data: own } = await admin.from('memberships').select('user_id').eq('org_id', org.id).eq('role', 'owner').limit(1).single();
const { data: rep } = await admin.from('memberships').select('user_id').eq('org_id', org.id).eq('role', 'sales_rep').limit(1).single();
const db = await session(own.user_id, org.id);
const dbRep = await session(rep.user_id, org.id);

const trace = { pipelines: new Set(), deals: new Set(), clients: new Set(), membership: null, acces: new Set() };
let ok = 0, ko = 0;
const verif = (n, c, d = '') => { c ? ok++ : ko++; console.log(`${c ? '✅' : '❌'} ${n}${d ? '  — ' + d : ''}`); };
const refuse = (n, r, motif) => verif(n, !!r.error && (!motif || r.error.message.includes(motif)), r.error?.message ?? 'ACCEPTÉ !');
const etapes = async (pid) => (await admin.from('pipeline_stages').select('id,name_fr,kind,probability,position,show_in_reports,show_in_pie,archived_at').eq('pipeline_id', pid).order('position')).data;
const actifs = async () => (await admin.from('pipelines_ventes').select('id,name,position,is_default').eq('org_id', org.id).is('archived_at', null).order('position')).data;
const evenements = async (dealId) => (await admin.from('pipeline_events').select('id', { count: 'exact', head: true }).eq('deal_id', dealId)).count;

const avant = await actifs();
const ordreInitial = avant.map((p) => p.id);
try {
  // ── Créer (modal) : 4 étapes FR, probabilités vides → réparties ──
  const r1 = await db.rpc('pipeline_enregistrer', {
    p_id: null, p_nom: 'ZZSonde Ventes', p_color_mode: 'dot', p_use_deal_probability: false,
    p_etapes: [
      { nom_fr: 'Nouveau lead' }, { nom_fr: 'Contacté' }, { nom_fr: 'Soumission envoyée' }, { nom_fr: 'Fermé' },
    ],
  });
  if (r1.error) throw r1.error;
  const A = r1.data; trace.pipelines.add(A);
  const eA = await etapes(A);
  verif('Créer : 4 étapes + Gagné + Perdu ajoutés', eA.map((e) => e.kind).join(',') === 'open,open,open,open,won,lost');
  verif('Créer : probabilités réparties 20/40/60/80', eA.slice(0, 4).map((e) => Number(e.probability)).join('/') === '20/40/60/80');
  verif('Créer : rangé en dernier', (await actifs()).at(-1).id === A);

  const r1b = await db.rpc('pipeline_enregistrer', { p_id: null, p_nom: 'zzsonde ventes ', p_color_mode: 'none', p_use_deal_probability: false, p_etapes: [{ nom_fr: 'X' }] });
  refuse('Nom déjà pris (casse et espaces ignorés) → refusé', r1b, 'déjà ce nom');
  refuse('Aucune étape → refusé', await db.rpc('pipeline_enregistrer', { p_id: null, p_nom: 'ZZSonde vide', p_color_mode: 'none', p_use_deal_probability: false, p_etapes: [] }), 'au moins une étape');
  refuse('Probabilité 150 → refusée', await db.rpc('pipeline_enregistrer', { p_id: null, p_nom: 'ZZSonde proba', p_color_mode: 'none', p_use_deal_probability: false, p_etapes: [{ nom_fr: 'X', probability: 150 }] }), 'entre 0 et 100');

  // 7 étapes sans probabilité → 12,5… ; décimales conservées
  const r7 = await db.rpc('pipeline_enregistrer', { p_id: null, p_nom: 'ZZSonde Sept', p_color_mode: 'none', p_use_deal_probability: false,
    p_etapes: [1, 2, 3, 4, 5, 6].map((i) => ({ nom_fr: `É${i}` })) });
  if (r7.error) throw r7.error;
  trace.pipelines.add(r7.data);
  verif('6 étapes ouvertes → 14,29 / 28,57 … 85,71 (comme GHL)', (await etapes(r7.data)).slice(0, 6).map((e) => Number(e.probability)).join(' ') === '14.29 28.57 42.86 57.14 71.43 85.71');

  // ── Modifier via ⋮ (même modal) : renommer, réordonner, ajouter, retirer ──
  const [n1, n2, n3, n4, g, p] = eA;
  const rM = await db.rpc('pipeline_enregistrer', {
    p_id: A, p_nom: 'ZZSonde Ventes B2B', p_color_mode: 'tint', p_use_deal_probability: true,
    p_etapes: [
      { id: n2.id, nom_fr: 'Contacté', probability: 33.33 }, { id: n1.id, nom_fr: 'Nouveau lead' },
      { nom_fr: 'Visite planifiée', probability: 50 }, { id: n3.id, nom_fr: 'Soumission envoyée', show_in_pie: false },
      { id: g.id, nom_fr: 'Gagné', kind: 'won' }, { id: p.id, nom_fr: 'Perdu', kind: 'lost' },
    ],
  });
  if (rM.error) throw rM.error;
  const eM = (await etapes(A)).filter((e) => !e.archived_at);
  verif('Modifier : nouvel ordre + étape ajoutée', eM.map((e) => e.name_fr).join(' | ') === 'Contacté | Nouveau lead | Visite planifiée | Soumission envoyée | Gagné | Perdu');
  verif('Modifier : « Fermé » retiré → archivé', (await etapes(A)).find((e) => e.id === n4.id).archived_at !== null);
  verif('Modifier : probabilité décimale gardée (33,33)', Number(eM[0].probability) === 33.33);
  verif('Modifier : camembert décoché', eM[3].show_in_pie === false);
  refuse('Modifier : retirer Gagné → refusé (verrouillé)', await db.rpc('pipeline_enregistrer', {
    p_id: A, p_nom: 'ZZSonde Ventes B2B', p_color_mode: 'tint', p_use_deal_probability: true,
    p_etapes: eM.filter((e) => e.kind !== 'won').map((e) => ({ id: e.id, nom_fr: e.name_fr, kind: e.kind })),
  }), 'verrouillées');

  // ── Deals de test dans A, pour les suppressions ──
  const cree = async (nom, etape) => {
    const r = await db.rpc('pipeline_creer_deal', { p_first_name: 'ZZSonde', p_last_name: nom, p_pipeline_id: A });
    if (r.error) throw r.error;
    trace.deals.add(r.data.deal_id); trace.clients.add(r.data.client_id);
    if (etape) {
      const { error } = await db.from('deals').update({ stage_id: etape }).eq('id', r.data.deal_id);
      if (error) throw error;
    }
    return r.data.deal_id;
  };
  const d1 = await cree('Un', eM[3].id);   // dans « Soumission envoyée »
  const d2 = await cree('Deux', eM[3].id);
  const evAvant = await evenements(d1);

  // ── Supprimer une étape qui contient des deals ──
  refuse('Supprimer étape avec deals, sans destination → refusé', await db.rpc('pipeline_supprimer_etape', { p_etape: eM[3].id }), 'choisissez');
  refuse('Supprimer Gagné → refusé (cadenas)', await db.rpc('pipeline_supprimer_etape', { p_etape: eM[4].id }), 'verrouillées');
  const rSE = await db.rpc('pipeline_supprimer_etape', { p_etape: eM[3].id, p_dest: eM[2].id });
  if (rSE.error) throw rSE.error;
  const dd1 = (await admin.from('deals').select('stage_id').eq('id', d1).single()).data;
  verif('Supprimer étape : 2 deals déplacés vers « Visite planifiée »', rSE.data === 2 && dd1.stage_id === eM[2].id);
  verif('Déplacement administratif : AUCUNE automatisation déclenchée', (await evenements(d1)) === evAvant, `${evAvant} → ${await evenements(d1)} événements`);

  // Un déplacement NORMAL émet toujours ses événements (Gagné → job en dépend).
  const { error: eMv } = await db.from('deals').update({ stage_id: eM[4].id }).eq('id', d2);
  if (eMv) throw eMv;
  verif('Déplacement normal vers Gagné : événements toujours émis', (await evenements(d2)) > evAvant);
  const dGagne = (await admin.from('deals').select('statut').eq('id', d2).single()).data;
  verif('Déplacement vers Gagné : statut « gagné » (déclenche la création de job)', dGagne.statut === 'gagne', dGagne.statut);

  // ── Dupliquer ──
  const rD = await db.rpc('pipeline_dupliquer', { p_id: A });
  if (rD.error) throw rD.error;
  trace.pipelines.add(rD.data);
  const copie = (await admin.from('pipelines_ventes').select('name,color_mode,use_deal_probability').eq('id', rD.data).single()).data;
  const eCopie = (await etapes(rD.data)).filter((e) => !e.archived_at);
  const dealsCopie = (await admin.from('deals').select('id', { count: 'exact', head: true }).eq('pipeline_id', rD.data)).count;
  verif('Dupliquer : « (copie) », mêmes réglages', copie.name === 'ZZSonde Ventes B2B (copie)' && copie.color_mode === 'tint' && copie.use_deal_probability === true);
  verif('Dupliquer : mêmes étapes actives, dans l\'ordre', eCopie.map((e) => e.name_fr).join('|') === (await etapes(A)).filter((e) => !e.archived_at).map((e) => e.name_fr).join('|'));
  verif('Dupliquer : SANS les deals', dealsCopie === 0);

  // ── Réordonner (glisser-déposer / Déplacer à la position) + défaut ──
  const liste = (await actifs()).map((x) => x.id);
  const nouvelOrdre = [A, ...liste.filter((x) => x !== A)];
  const rR = await db.rpc('pipeline_reordonner', { p_ids: nouvelOrdre });
  if (rR.error) throw rR.error;
  const apresR = await actifs();
  verif('Réordonner : A passe en 1er', apresR[0].id === A);
  verif('Le 1er de la liste devient le pipeline par défaut', apresR[0].is_default && apresR.filter((x) => x.is_default).length === 1);
  refuse('Réordonner avec une liste incomplète → refusé', await db.rpc('pipeline_reordonner', { p_ids: [A] }), 'ne correspond pas');

  // ── Supprimer un pipeline qui contient des deals ──
  const dest = apresR[1];
  const destEtape = (await etapes(dest.id)).find((e) => e.kind === 'open' && !e.archived_at);
  refuse('Supprimer pipeline avec deals, sans destination → refusé', await db.rpc('pipeline_supprimer', { p_id: A }), 'choisissez');
  refuse('Destination = étape Gagné → refusée', await db.rpc('pipeline_supprimer', { p_id: A, p_dest_pipeline: dest.id, p_dest_etape: (await etapes(dest.id)).find((e) => e.kind === 'won').id }), 'étape ouverte');
  const evD1 = await evenements(d1);
  const rS = await db.rpc('pipeline_supprimer', { p_id: A, p_dest_pipeline: dest.id, p_dest_etape: destEtape.id });
  if (rS.error) throw rS.error;
  const deplace = (await admin.from('deals').select('pipeline_id,stage_id,deleted_at').eq('id', d1).single()).data;
  const pa = (await admin.from('pipelines_ventes').select('archived_at,is_default').eq('id', A).single()).data;
  verif('Supprimer pipeline : deals déplacés, pas effacés', deplace.pipeline_id === dest.id && deplace.stage_id === destEtape.id && deplace.deleted_at === null);
  verif('Supprimer pipeline : archivé (suppression douce), plus par défaut', pa.archived_at !== null && pa.is_default === false);
  verif('Supprimer pipeline : aucune automatisation déclenchée', (await evenements(d1)) === evD1);
  const apresS = await actifs();
  verif('Le nouveau 1er devient le défaut', apresS[0].is_default === true && apresS.filter((x) => x.is_default).length === 1);
  refuse('Nouveau deal vers un pipeline archivé → refusé', await db.rpc('pipeline_creer_deal', { p_first_name: 'ZZSonde', p_pipeline_id: A }), 'introuvable');

  // ── Permissions : un vendeur ──
  const r2 = await dbRep.rpc('pipeline_enregistrer', { p_id: rD.data, p_nom: 'ZZSonde rep', p_color_mode: 'none', p_use_deal_probability: false, p_etapes: [{ nom_fr: 'X' }] });
  refuse('Vendeur SANS droit : modifier → refusé', r2, 'droit');
  const { data: acc, error: eAcc } = await db.from('pipeline_acces').insert({ org_id: org.id, pipeline_id: rD.data, user_id: rep.user_id, peut_modifier: true }).select('id').single();
  if (eAcc) throw eAcc;
  trace.acces.add(acc.id);
  const { error: eRen } = await dbRep.from('pipelines_ventes').update({ name: 'ZZSonde renommé par le vendeur' }).eq('id', rD.data);
  const renomme = (await admin.from('pipelines_ventes').select('name').eq('id', rD.data).single()).data.name;
  verif('Vendeur AVEC « Modifier » : peut renommer', !eRen && renomme === 'ZZSonde renommé par le vendeur', eRen?.message);
  refuse('Vendeur : dupliquer → refusé (admin seulement)', await dbRep.rpc('pipeline_dupliquer', { p_id: rD.data }), 'administrateurs');
  refuse('Vendeur : supprimer → refusé (admin seulement)', await dbRep.rpc('pipeline_supprimer', { p_id: rD.data }), 'administrateurs');

  // ── Copier vers un autre bureau ──
  const { error: eM2 } = await admin.from('memberships').insert({ org_id: autreOrg.id, user_id: own.user_id, role: 'admin', status: 'active' });
  if (eM2) throw eM2;
  trace.membership = true;
  const bureaux = await db.rpc('pipeline_bureaux_administres');
  verif('Bureaux administrés : l\'autre bureau est proposé', (bureaux.data ?? []).some((b) => b.org_id === autreOrg.id), bureaux.error?.message);
  const rC = await db.rpc('pipeline_copier_vers_bureaux', { p_id: rD.data, p_orgs: [autreOrg.id] });
  if (rC.error) throw rC.error;
  const copieAilleurs = (await admin.from('pipelines_ventes').select('id').eq('org_id', autreOrg.id).eq('name', 'ZZSonde renommé par le vendeur').maybeSingle()).data;
  if (copieAilleurs) trace.pipelines.add(copieAilleurs.id);
  verif('Copier vers le bureau : pipeline + étapes présents là-bas', !!copieAilleurs && (await etapes(copieAilleurs.id)).length === eCopie.length);
  // Une organisation où ce propriétaire n'a AUCUNE adhésion, et qui a un pipeline actif.
  const { data: mesOrgs } = await admin.from('memberships').select('org_id').eq('user_id', own.user_id);
  const exclues = new Set((mesOrgs ?? []).map((x) => x.org_id));
  const { data: candidats } = await admin.from('pipelines_ventes').select('org_id').is('archived_at', null).limit(200);
  const etranger = { id: (candidats ?? []).map((x) => x.org_id).find((o) => !exclues.has(o)) };
  refuse('Copier vers un bureau NON administré → refusé', await db.rpc('pipeline_copier_vers_bureaux', { p_id: rD.data, p_orgs: [etranger.id] }), 'administrateur');

  // ── Isolation entre entreprises ──
  const { data: pEtr } = await admin.from('pipelines_ventes').select('id').eq('org_id', etranger.id).is('archived_at', null).limit(1).single();
  const lu = await db.from('pipelines_ventes').select('id').eq('id', pEtr.id);
  verif('Isolation : le pipeline d\'une autre entreprise est invisible', (lu.data ?? []).length === 0);
  const { data: modifie } = await db.from('pipelines_ventes').update({ name: 'piraté' }).eq('id', pEtr.id).select('id');
  verif('Isolation : impossible de le modifier', (modifie ?? []).length === 0);
  refuse('Isolation : impossible de le dupliquer', await db.rpc('pipeline_dupliquer', { p_id: pEtr.id }), 'introuvable');
  refuse('Isolation : impossible de le supprimer', await db.rpc('pipeline_supprimer', { p_id: pEtr.id }), 'introuvable');

  // ── Dernier pipeline ──
  const { data: seul } = await admin.from('orgs').select('id').eq('name', autreOrg.name).single();
  const dbAutre = await session(own.user_id, seul.id);
  const actifsAutre = (await admin.from('pipelines_ventes').select('id').eq('org_id', seul.id).is('archived_at', null)).data;
  // On supprime la copie (2 pipelines → 1), puis on tente le dernier.
  await dbAutre.rpc('pipeline_supprimer', { p_id: copieAilleurs.id });
  const restant = actifsAutre.find((x) => x.id !== copieAilleurs.id);
  refuse('Supprimer le DERNIER pipeline → refusé', await dbAutre.rpc('pipeline_supprimer', { p_id: restant.id }), 'dernier');
} catch (e) {
  ko++; console.log('💥 arrêt :', e.message ?? e);
} finally {
  // Nettoyage : deals/clients de test, accès, adhésion temporaire, pipelines
  // de test (effacement réel : ce sont des lignes créées par ce script).
  for (const id of trace.deals) { await admin.from('pipeline_events').delete().eq('deal_id', id); await admin.from('deals').delete().eq('id', id); }
  for (const id of trace.clients) await admin.from('clients').delete().eq('id', id);
  for (const id of trace.acces) await admin.from('pipeline_acces').delete().eq('id', id);
  if (trace.membership) await admin.from('memberships').delete().eq('org_id', autreOrg.id).eq('user_id', own.user_id);
  for (const id of trace.pipelines) await admin.from('pipelines_ventes').delete().eq('id', id);
  // Remettre l'ordre et le défaut d'origine de Vision Lavage.
  let pos = 1;
  for (const id of ordreInitial) await admin.from('pipelines_ventes').update({ position: pos++ }).eq('id', id);
  await admin.rpc('pipeline_resynchroniser_defaut', { p_org: org.id }).then(() => {}, () => {});
  const apres = await actifs();
  const reste = (await admin.from('pipelines_ventes').select('id').ilike('name', 'ZZSonde%')).data.length
    + (await admin.from('clients').select('id').ilike('last_name', 'Un').ilike('first_name', 'ZZSonde')).data.length;
  console.log(`\n${ok} ✅  ${ko} ❌   — nettoyage : ${reste === 0 ? 'rien ne reste' : reste + ' ligne(s) restante(s)'} ; ordre d'origine ${JSON.stringify(apres.map((p) => p.id)) === JSON.stringify(ordreInitial) ? 'rétabli' : 'DIFFÉRENT'} ; défaut = ${apres.find((p) => p.is_default)?.name}`);
}
