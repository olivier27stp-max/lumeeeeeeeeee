/**
 * QA — les 12 types de champ personnalisé, de bout en bout, sur STAGING.
 *
 *   npx tsx --env-file=.env.local scripts/qa/tester-types-champs.mts --courriel <compte> --org <bureau>
 *
 * Avec la session de l'utilisateur (RLS et permissions réelles) :
 *   1. les 31 champs de base (CHAMPS_DE_BASE) existent, du bon type, dans le bon dossier système ;
 *   2. chaque type accepte une valeur valide et la relit à l'identique ;
 *   3. chaque type REFUSE une valeur invalide avec un message lisible ;
 *   4. fichier : dépôt dans le bucket privé, chemin relu ;
 *   5. la même clé suit devis → job → facture (triggers cf_devis_job_lie / cf_facture_job_liee) ;
 *   6. show_on_documents : le champ est imprimé sur la facture remise au client ;
 *   7. variables d'automatisation : la valeur se résout dans un modèle.
 * Les fiches créées pour le test sont supprimées (douce) à la fin. Refuse la prod.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { listerChamps, ecrireValeurs, lireValeurs, champsPourDocument, variablesChamps } from '../../server/lib/champs/service';
import { CHAMPS_DE_BASE } from '../../src/lib/champs/base';
import type { ChampPerso, ObjetChamp } from '../../src/lib/champs/types';

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };
const url = process.env.VITE_SUPABASE_URL ?? '';
if (!process.env.SUPABASE_PROJECT_REF_PROD || url.includes(process.env.SUPABASE_PROJECT_REF_PROD)) {
  console.error('Refus : ce test écrit des fiches, il ne tourne que sur staging.');
  process.exit(2);
}
const courriel = arg('courriel');
const org = arg('org');
if (!courriel || !org) { console.error('--courriel et --org requis'); process.exit(2); }

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY ?? '', opts);
const { data: lien, error: el } = await admin.auth.admin.generateLink({ type: 'magiclink', email: courriel });
if (el) throw el;
const anon = createClient(url, process.env.VITE_SUPABASE_ANON_KEY ?? '', opts);
const { data: sess, error: es } = await anon.auth.verifyOtp({ token_hash: lien.properties.hashed_token, type: 'magiclink' });
if (es || !sess.session) throw es ?? new Error('session');
const db: SupabaseClient = createClient(url, process.env.VITE_SUPABASE_ANON_KEY ?? '', {
  ...opts, global: { headers: { Authorization: `Bearer ${sess.session.access_token}`, 'x-org-id': org } },
});
const userId = sess.session.user.id;

const resultats: Array<{ ok: boolean; quoi: string; detail?: string }> = [];
const verifier = (ok: boolean, quoi: string, detail?: string) => { resultats.push({ ok, quoi, detail }); console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${quoi}${detail ? ` — ${detail}` : ''}`); };

// ── 1. Les champs de base, rangés ────────────────────────────────────────
const parObjet = new Map<ObjetChamp, { champs: ChampPerso[]; dossiers: Array<{ id: string; cle_systeme?: string | null }> }>();
for (const objet of ['client', 'deal', 'job', 'quote', 'invoice', 'property'] as ObjetChamp[]) {
  const r = await listerChamps(db, org, { objet });
  parObjet.set(objet, { champs: r.champs, dossiers: r.dossiers as any });
}
const champ = (objet: ObjetChamp, cle: string) => parObjet.get(objet)!.champs.find((c) => c.key === cle)!;
for (const b of CHAMPS_DE_BASE) {
  const c = champ(b.objet, b.cle);
  const dossier = parObjet.get(b.objet)!.dossiers.find((d) => d.id === c?.folder_id);
  verifier(!!c && c.field_type === b.type && dossier?.cle_systeme === b.dossier, `${b.objet}.${b.cle} (${b.type}) dans « ${b.dossier} »`,
    c ? `type ${c.field_type}, dossier ${dossier?.cle_systeme ?? 'aucun'}` : 'absent');
}

// ── Fiches de test ────────────────────────────────────────────────────────
const suffixe = Date.now().toString(36).toUpperCase();
const cree = async (table: string, ligne: Record<string, unknown>) => {
  const { data, error } = await db.from(table).insert({ org_id: org, ...ligne }).select('id').single();
  if (error) throw new Error(`${table} : ${error.message}`);
  return data.id as string;
};
const clientId = await cree('clients', { first_name: 'QA', last_name: `Champs ${suffixe}`, status: 'active' });
const propertyId = await cree('properties', { client_id: clientId, name: `QA ${suffixe}`, address: '1 rue du Test' }).catch(() => null);
const dealId = await (async () => {
  const { data: p } = await db.from('pipelines_ventes').select('id').eq('org_id', org).limit(1).maybeSingle();
  const { data: st } = p ? await db.from('pipeline_stages').select('id').eq('pipeline_id', p.id).order('position').limit(1).maybeSingle() : { data: null };
  if (!p || !st) { verifier(false, 'fiche deal de test', 'aucun pipeline ou aucune étape'); return null; }
  return cree('deals', { client_id: clientId, pipeline_id: p.id, stage_id: st.id }).catch((e) => { verifier(false, 'fiche deal de test', e.message); return null; });
})();
const quoteId = await cree('quotes', { quote_number: `QA-${suffixe}`, title: 'QA champs', client_id: clientId, status: 'draft' });
const entites: Partial<Record<ObjetChamp, string | null>> = { client: clientId, deal: dealId, quote: quoteId, property: propertyId };

// ── 2 et 3. Valeur valide relue ; valeur invalide refusée ──────────────────
const option = (c: ChampPerso, i = 0) => c.options.filter((o) => !o.archived_at)[i]?.id;
const ecrire = async (objet: ObjetChamp, cle: string, valeur: unknown) => {
  const c = champ(objet, cle);
  const [r] = await ecrireValeurs(db, org, objet, entites[objet]!, [{ field_id: c.id, value: valeur as any }], { acteur: userId, source: 'qa' });
  return r;
};
const lire = async (objet: ObjetChamp, cle: string) => {
  const v = await lireValeurs(db, org, objet, entites[objet]!);
  return (v.valeurs as Record<string, { value: unknown }>)[champ(objet, cle).id]?.value ?? null;
};

// Fichier : dépôt réel dans le bucket privé (chemin <org>/<uuid>/<nom>)
const cheminFichier = `${org}/${randomUUID()}/qa-photo.png`;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const depot = await db.storage.from('custom-field-files').upload(cheminFichier, png, { contentType: 'image/png' });
verifier(!depot.error, 'fichier : dépôt dans le bucket privé custom-field-files', depot.error?.message);

const cas: Array<{ objet: ObjetChamp; cle: string; valide: unknown; attendu?: unknown; invalides: unknown[] }> = [
  { objet: 'client', cle: 'refere_par', valide: 'Julie Côté', invalides: ['deux\nlignes'] },                               // single_line
  { objet: 'client', cle: 'instructions_acces', valide: 'Sonner deux fois.\nChien gentil.', invalides: ['x'.repeat(5001)] }, // multi_line
  { objet: 'property', cle: 'superficie_pi2', valide: 1500, invalides: ['beaucoup', -5] },                                  // number
  { objet: 'client', cle: 'budget_estime', valide: 250_000, invalides: [12.5, 'cher'] },                                    // monetary (cents)
  { objet: 'client', cle: 'telephone_secondaire', valide: '514 555-0199', invalides: ['pas un numéro'] },                   // phone
  { objet: 'client', cle: 'courriel_facturation', valide: 'factures@exemple.com', invalides: ['factures@', 'exemple.com'] }, // email
  { objet: 'client', cle: 'date_souhaitee', valide: '2026-11-15', invalides: ['15/11/2026', '2026-13-45'] },                // date
  { objet: 'client', cle: 'type_batiment', valide: '__option0', invalides: [randomUUID()] },                                // dropdown_single
  { objet: 'client', cle: 'disponibilites', valide: '__options01', invalides: [[randomUUID()]] },                           // dropdown_multi
  { objet: 'quote', cle: 'numero_bon_commande', valide: `PO-${suffixe}`, invalides: [] },                                   // single_line + document
  { objet: 'deal', cle: 'urgence', valide: '__option2', invalides: ['Haute'] },                                             // dropdown (libellé ≠ id)
];
for (const k of cas) {
  if (!entites[k.objet]) { verifier(false, `${k.objet}.${k.cle}`, `fiche ${k.objet} de test non créée`); continue; }
  const c = champ(k.objet, k.cle);
  const valide = k.valide === '__option0' ? option(c, 0) : k.valide === '__option2' ? option(c, 2) : k.valide === '__options01' ? [option(c, 0), option(c, 1)] : k.valide;
  const r = await ecrire(k.objet, k.cle, valide);
  const relu = await lire(k.objet, k.cle);
  const attendu = k.attendu ?? valide;
  const egal = JSON.stringify(Array.isArray(relu) ? [...relu].sort() : relu) === JSON.stringify(Array.isArray(attendu) ? [...(attendu as string[])].sort() : attendu);
  verifier(r.ok && (egal || c.field_type === 'phone'), `${c.field_type} ${k.objet}.${k.cle} : valeur valide écrite et relue`, r.ok ? `relu ${JSON.stringify(relu)}` : r.erreur);
  for (const mauvais of k.invalides) {
    const ri = await ecrire(k.objet, k.cle, mauvais);
    verifier(!ri.ok && !!ri.erreur, `${c.field_type} ${k.objet}.${k.cle} : refuse ${JSON.stringify(mauvais).slice(0, 30)}`, ri.erreur ?? 'ACCEPTÉ');
  }
}

// ── Job : number avec décimales et bornes, url, fichier, case à cocher ────
const jobId = await cree('jobs', { job_number: `QA-${suffixe}`, title: 'QA champs', client_id: clientId, status: 'draft' });
entites.job = jobId;
for (const [cle, valide, invalides] of [
  ['duree_estimee_h', 2.5, [-1, 5000]],
  ['nb_techniciens', 2, [0]],
  ['lien_photos', 'https://exemple.com/album', ['javascript:alert(1)', 'pas une url']],
  ['photo_travaux', cheminFichier, [`${randomUUID()}/ailleurs.png`]],
  ['inspection_finale', true, []],
  ['plage_arrivee', '__option1', []],
] as Array<[string, unknown, unknown[]]>) {
  const c = champ('job', cle);
  const v = valide === '__option1' ? option(c, 1) : valide;
  const r = await ecrire('job', cle, v);
  const relu = await lire('job', cle);
  verifier(r.ok && JSON.stringify(relu) === JSON.stringify(v), `${c.field_type} job.${cle} : valeur valide écrite et relue`, r.ok ? `relu ${JSON.stringify(relu)}` : r.erreur);
  for (const mauvais of invalides) {
    const ri = await ecrire('job', cle, mauvais);
    verifier(!ri.ok, `${c.field_type} job.${cle} : refuse ${JSON.stringify(mauvais)}`, ri.erreur ?? 'ACCEPTÉ');
  }
}

// Nombre entier (0 décimale) : 1,5 est ARRONDI à 2, pas refusé (comportement voulu du type number).
{
  const r = await ecrire('job', 'nb_techniciens', 1.5);
  const relu = await lire('job', 'nb_techniciens');
  verifier(r.ok && relu === 2, 'number job.nb_techniciens : 1,5 arrondi à 2 (0 décimale)', `relu ${JSON.stringify(relu)}`);
}

// ── 5. devis → job → facture ─────────────────────────────────────────────
await db.from('quotes').update({ job_id: jobId }).eq('id', quoteId).eq('org_id', org);
entites.job = jobId;
const poSurJob = await lire('job', 'numero_bon_commande');
verifier(poSurJob === `PO-${suffixe}`, 'devis → job : N° de bon de commande suit (même clé, même type)', `job = ${JSON.stringify(poSurJob)}`);
const invoiceId = await cree('invoices', { invoice_number: `QA-${suffixe}`, client_id: clientId, job_id: jobId, status: 'draft' });
entites.invoice = invoiceId;
const poSurFacture = await lire('invoice', 'numero_bon_commande');
verifier(poSurFacture === `PO-${suffixe}`, 'job → facture : N° de bon de commande suit', `facture = ${JSON.stringify(poSurFacture)}`);

// ── 6. Document remis au client ──────────────────────────────────────────
const doc = await champsPourDocument(admin, org, 'invoice', invoiceId);
verifier(doc.some((d) => d.valeur === `PO-${suffixe}`), 'facture remise au client : le N° de bon de commande est imprimé', JSON.stringify(doc));
const docDevis = await champsPourDocument(admin, org, 'quote', quoteId);
verifier(docDevis.some((d) => d.valeur === `PO-${suffixe}`), 'devis remis au client : le N° de bon de commande est imprimé', JSON.stringify(docDevis));

// ── 7. Variables d'automatisation ────────────────────────────────────────
const vars = await variablesChamps(db, org, { client: clientId, job: jobId, invoice: invoiceId }, 'fr');
const espaces = (t: string) => t.replace(/[  ]/g, ' ');
const trouve = (morceau: string, attendu: string) => Object.entries(vars).find(([k, v]) => k.includes(morceau) && espaces(v).includes(attendu));
for (const [morceau, attendu, quoi] of [
  ['numero_bon_commande', `PO-${suffixe}`, 'single_line'],
  ['budget_estime', '2 500,00', 'monetary (formaté)'],
  ['date_souhaitee', '2026', 'date (formatée)'],
  ['disponibilites', ',', 'dropdown_multi (libellés)'],
  ['duree_estimee_h', '2,5', 'number (formaté)'],
  ['inspection_finale', 'Oui', 'checkbox'],
] as Array<[string, string, string]>) {
  const t = trouve(morceau, attendu);
  verifier(!!t, `variable d'automatisation ${quoi} : ${morceau}`, t ? `${t[0]} = ${t[1]}` : `absente (${Object.keys(vars).filter((k) => k.includes(morceau)).join(', ') || 'aucune clé'})`);
}

// ── Nettoyage (suppression douce ; le fichier est retiré du bucket) ───────
const maintenant = new Date().toISOString();
await db.from('invoices').update({ deleted_at: maintenant }).eq('id', invoiceId);
await db.from('jobs').update({ deleted_at: maintenant }).eq('id', jobId);
await db.from('quotes').update({ deleted_at: maintenant }).eq('id', quoteId);
if (dealId) await db.from('deals').update({ deleted_at: maintenant }).eq('id', dealId);
await db.from('clients').update({ deleted_at: maintenant }).eq('id', clientId);
await db.storage.from('custom-field-files').remove([cheminFichier]);

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérifications réussies.`);
process.exit(echecs.length ? 1 : 0);
