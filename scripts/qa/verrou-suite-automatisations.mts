/**
 * Verrou de la suite `npm run test:automations` — UNE exécution à la fois par
 * base (staging ou prod), où qu'elle tourne (CI de n'importe quelle PR, poste
 * d'un développeur, QA Smoke). Les exécutions partagent le même bureau de
 * test : deux à la fois se liraient les envois simulés et la file planifiée.
 *
 * Pourquoi pas le `concurrency` de GitHub : il ne garde qu'UNE exécution en
 * attente par groupe — chaque nouvelle PR ANNULAIT le job de la précédente
 * (vu le 2026-10-01 sur les PR des autres sessions). Ici, on attend son tour.
 *
 * Le verrou est une ligne `org_features` du bureau de test A
 * (`qa_suite_verrou`), prise par une mise à jour conditionnelle (atomique).
 * Un titulaire disparu sans rendre (job tué) : le verrou est repris après
 * PEREMPTION_MIN.
 *
 *   tsx scripts/qa/verrou-suite-automatisations.mts prendre <titulaire>
 *   tsx scripts/qa/verrou-suite-automatisations.mts rendre  <titulaire>
 */
import { assurerBureauTest } from '../../tests/automations-suite/harnais/bureau-test';

const FEATURE = 'qa_suite_verrou';
const PEREMPTION_MIN = 100;
const ATTENTE_MAX_MIN = 75;
const PAS_MS = 20_000;

const [action, titulaire] = process.argv.slice(2);
if (!['prendre', 'rendre'].includes(action) || !titulaire) {
  console.error('usage : verrou-suite-automatisations.mts prendre|rendre <titulaire>');
  process.exit(2);
}

const { admin, orgA } = await assurerBureauTest();

if (action === 'rendre') {
  const { error } = await admin.from('org_features')
    .update({ enabled: false, metadata: { rendu_par: titulaire, rendu_le: new Date().toISOString() } })
    .eq('org_id', orgA).eq('feature', FEATURE).eq('metadata->>titulaire', titulaire);
  if (error) console.error(`verrou non rendu : ${error.message}`);
  process.exit(0);
}

// La ligne existe (créée libre) — sans écraser un verrou tenu.
await admin.from('org_features').upsert({ org_id: orgA, feature: FEATURE, enabled: false }, { onConflict: 'org_id,feature', ignoreDuplicates: true });

const debut = Date.now();
let annonce = false;
for (;;) {
  const pris = { enabled: true, metadata: { titulaire, depuis: new Date().toISOString() } };
  // 1. Libre → on le prend (une seule ligne passe de false à true).
  const { data: libre, error } = await admin.from('org_features').update(pris)
    .eq('org_id', orgA).eq('feature', FEATURE).eq('enabled', false).select('id');
  if (error) { console.error(`verrou illisible : ${error.message}`); process.exit(1); }
  if (libre?.length) break;
  // 2. Tenu : périmé ? On le reprend seulement s'il n'a pas changé de main entre-temps.
  const { data: ligne } = await admin.from('org_features').select('metadata').eq('org_id', orgA).eq('feature', FEATURE).maybeSingle();
  const meta = (ligne?.metadata ?? {}) as { titulaire?: string; depuis?: string };
  const age = meta.depuis ? (Date.now() - Date.parse(meta.depuis)) / 60_000 : Infinity;
  if (age > PEREMPTION_MIN) {
    let reprise = admin.from('org_features').update(pris).eq('org_id', orgA).eq('feature', FEATURE).eq('enabled', true);
    reprise = meta.depuis ? reprise.eq('metadata->>depuis', meta.depuis) : reprise;
    const { data: repris } = await reprise.select('id');
    if (repris?.length) { console.warn(`verrou périmé (${Math.round(age)} min, ${meta.titulaire ?? '?'}) : repris.`); break; }
  }
  if (!annonce) { console.log(`Suite déjà en cours (${meta.titulaire ?? '?'}, depuis ${meta.depuis ?? '?'}) — on attend son tour.`); annonce = true; }
  if (Date.now() - debut > ATTENTE_MAX_MIN * 60_000) {
    console.error(`✗ Verrou de la suite non obtenu en ${ATTENTE_MAX_MIN} min (titulaire : ${meta.titulaire ?? '?'}).`);
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, PAS_MS));
}
console.log(`Verrou de la suite pris (${titulaire}).`);
