/* ═══════════════════════════════════════════════════════════════
   Agent F — que coûte une demande d'automatisation quand les outils
   d'automatisation ne sont PAS chargés d'office (jeu de base + recherche
   d'outils) ?

   C'est le cas quand le routeur n'a pas tranché le sujet. Pour le provoquer à
   coup sûr, l'API locale est lancée avec LUMI_ROUTEUR=off : chaque tour part
   alors avec les 15 outils du quotidien, les autres différés
   (`defer_loading`), découverts par `tool_search_tool_regex`.

     LUMI_ROUTEUR=off … node D:/lume-final/outils/serveurs.mjs D:/lume-final/wt-f 3496 5496 --lumi
     QA_AUTO_SUFFIXE=f npx tsx --env-file=.env.local scripts/qa/finale/f/recherche-outils.mts

   Deux demandes déjà mesurées avec le sujet « rapports » chargé (mesurer.mts,
   U3 et U7) : la comparaison se lit dans notes/F-mesures.md.
   Sortie : D:/lume-final/sorties/f-recherche-outils.json.
   ═══════════════════════════════════════════════════════════════ */
import { writeFileSync } from 'node:fs';
import { preparer, clavarder, deciderCarte, repere, releve, assembler, SORTIES, n, type Session } from './commun.mts';

const atelier = await preparer();
const { admin, orgA } = atelier;
const s: Session = { jeton: atelier.jetonA, orgId: orgA };

const NOM = 'Rappel de facture F';
const { data: regle } = await admin.from('automation_rules').select('id, name').eq('org_id', orgA).eq('name', NOM).is('deleted_at', null).maybeSingle();
if (!regle) throw new Error(`« ${NOM} » absente : lancer mesurer.mts d’abord.`);

const DEMANDES = [
  { id: 'R3-changer-texto', message: `Change le texto de l’automatisation « ${NOM} » pour : Bonjour [client_first_name], votre facture [invoice_number] est en retard : [invoice_link]. Merci, [company_name]` },
  { id: 'R7-renommer', message: `Renomme l’automatisation « ${NOM} » en « Rappel de facture F2 ».` },
];
const resultats: Array<Record<string, unknown>> = [];
for (const d of DEMANDES) {
  const depuis = await repere(admin, orgA);
  const r = await clavarder(s, d.message);
  let texte = r.texte; let latence = r.latence_ms;
  if (r.proposition && r.conversation_id) {
    const e = await deciderCarte(s, r.conversation_id, r.proposition.tool_use_id, 'confirm');
    texte += ` ⟶ [Confirmer] ${e.texte}`; latence += e.latence_ms;
  }
  const { usage, traces } = await releve(admin, orgA, depuis);
  const m = assembler({ id: d.id, chemin: 'clavardage', demande: d.message, reponse: texte, latence_ms: latence, usage, traces, carte: r.proposition?.tool ?? null, outilsVus: r.outils });
  resultats.push({
    ...m,
    appels: usage.map((l) => ({ modele: l.model, entree_plein_tarif: n(l.input_tokens), cache_lu: n(l.cache_read_input_tokens), cache_ecrit: n(l.cache_creation_input_tokens), sortie: n(l.output_tokens), cout_cents: n(l.cost_cents) })),
  });
  console.log(`${d.id} : ${m.cout_cents.toFixed(3)} ¢ · ${m.appels_modele} appels · outils chargés ${m.outils_charges} · carte ${m.carte ?? '—'} · ${latence} ms`);
  for (const l of usage) console.log(`   ${l.model.padEnd(18)} entrée ${String(l.input_tokens).padStart(6)} · lu ${String(l.cache_read_input_tokens).padStart(6)} · écrit ${String(l.cache_creation_input_tokens).padStart(6)} · sortie ${String(l.output_tokens).padStart(5)} · ${Number(l.cost_cents).toFixed(3)} ¢`);
  console.log(`   → ${texte.replace(/\s+/g, ' ').slice(0, 300)}`);
}
// Le nom d'origine est remis pour qu'une nouvelle passe retrouve la même automatisation.
await admin.from('automation_rules').update({ name: NOM }).eq('id', regle.id).eq('org_id', orgA);
writeFileSync(`${SORTIES}/f-recherche-outils.json`, JSON.stringify({ quand: new Date().toISOString(), routeur: 'off', resultats }, null, 1));
process.exit(0);
