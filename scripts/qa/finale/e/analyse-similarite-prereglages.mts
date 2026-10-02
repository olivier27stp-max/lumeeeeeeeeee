/**
 * Agent E — le seuil « quasi identique » ne doit JAMAIS avaler deux messages réellement
 * différents. Corpus : tous les textos et courriels des automatisations fournies par Lume
 * (préréglages + pack de base), résolus pour le même client et la même fiche. On mesure la
 * similarité de CHAQUE paire de messages différents d'un même canal, et celle de
 * reformulations écrites à la main.
 *
 *   npx tsx scripts/qa/finale/e/analyse-similarite-prereglages.mts
 *
 * Sortie : D:/lume-final/sorties/e/analyse-similarite.json (aucun réseau, aucune base).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { AUTOMATION_PRESETS } from '../../../../server/lib/automationPresets.data';
import { PACK_PARCOURS } from '../../../../server/lib/automationPack.data';
import { resolveTemplate } from '../../../../server/lib/actions/index';
import { similarite, normaliserMessage, liensDe, SEUIL_QUASI_IDENTIQUE } from './prototype-doublons';

const VARS: Record<string, string> = {
  client_first_name: 'Marie', client_last_name: 'Tremblay', client_name: 'Marie Tremblay', client_email: 'marie@exemple.ca', client_phone: '+15145550142',
  company_name: 'Lavage Éclair', company_phone: '514 555-0100', invoice_number: 'F-0042', invoice_total: '517,39 $', invoice_due_date: '15 octobre 2026',
  invoice_link: 'https://app.exemple.test/invoice/11111111-1111-4111-8111-111111111111', quote_number: 'D-0218', quote_total: '1 437,19 $',
  quote_valid_until: '2 novembre 2026', quote_link: 'https://app.exemple.test/quote/22222222-2222-4222-8222-222222222222',
  appointment_date: '14 octobre 2026', appointment_time: '09 h 00', appointment_title: 'Lavage de vitres', appointment_address: '120 rue Principale, Montréal',
  job_name: 'Lavage de vitres', google_review_url: 'https://g.page/r/exemple/review', review_page_url: 'https://app.exemple.test/survey/33333333-3333-4333-8333-333333333333',
  review_link: 'https://app.exemple.test/survey/33333333-3333-4333-8333-333333333333', survey_url: 'https://app.exemple.test/survey/33333333-3333-4333-8333-333333333333',
  contract_link: '', contract_line: '', contract_html: '', deposit_amount: '150,00 $', deposit_line: '', signed_contract_link: '',
};

interface Message { source: string; declencheur: string; canal: 'texto' | 'courriel'; texte: string }
/** La « famille » d'un message : ce à quoi il sert. Un préréglage et sa reprise dans le pack sont de la même famille. */
const famille = (cle: string) => cle.replace(/#.*$/, '')
  .replace(/^pack_relance_facture$/, 'invoice_sent_reminder').replace(/^pack_relance_devis$/, 'quote_followup')
  .replace(/^(pack_rendez_vous|appointment_confirmation|job_reminder.*)$/, 'rendez_vous')
  .replace(/^(pack_suivi_prospect|welcome_new_lead|lead_followup.*)$/, 'prospect')
  .replace(/^(pack_depot|deposit_reminder|deposit_followup.*)$/, 'depot')
  .replace(/_\d+[dhm]$/, '');
const corpus: Message[] = [];
const ajouter = (source: string, declencheur: string, action: { type?: string; config?: Record<string, unknown> } | undefined) => {
  if (!action?.config) return;
  if (action.type === 'send_sms' && typeof action.config.body === 'string') {
    corpus.push({ source, declencheur, canal: 'texto', texte: resolveTemplate(action.config.body, VARS) });
  }
  if (action.type === 'send_email' && typeof action.config.body === 'string') {
    corpus.push({ source, declencheur, canal: 'courriel', texte: `${resolveTemplate(String(action.config.subject ?? ''), VARS)}\n${resolveTemplate(action.config.body, VARS, { html: true })}` });
  }
};
for (const p of AUTOMATION_PRESETS) for (const a of (p.actions ?? []) as Array<{ type?: string; config?: Record<string, unknown> }>) ajouter(p.preset_key, p.trigger_event, a);
for (const p of PACK_PARCOURS) {
  for (const e of ((p as unknown as { steps?: Array<{ id?: string; action?: { type?: string; config?: Record<string, unknown> } }> }).steps ?? [])) {
    ajouter(`${p.preset_key}#${e.id ?? ''}`, p.trigger_event, e.action);
  }
}

// ── 1. Toutes les paires de messages DIFFÉRENTS d'un même canal ──
const paires: Array<{ a: string; b: string; canal: string; meme_declencheur: boolean; meme_famille: boolean; s: number; meme_lien: boolean; identiques: boolean }> = [];
for (let i = 0; i < corpus.length; i++) {
  for (let j = i + 1; j < corpus.length; j++) {
    const [x, y] = [corpus[i], corpus[j]];
    if (x.canal !== y.canal) continue;
    // Un parcours du pack reprend le texte d'un préréglage : ce n'est pas une paire « différente ».
    const identiques = normaliserMessage(x.texte) === normaliserMessage(y.texte);
    const liensCommuns = liensDe(x.texte).filter((l) => /\/(invoice|quote|pay|survey|contract)\//.test(l) && liensDe(y.texte).includes(l));
    paires.push({ a: x.source, b: y.source, canal: x.canal, meme_declencheur: x.declencheur === y.declencheur, meme_famille: famille(x.source) === famille(y.source), s: Math.round(similarite(x.texte, y.texte) * 100) / 100, meme_lien: liensCommuns.length > 0, identiques });
  }
}
const differentes = paires.filter((p) => !p.identiques);
const auDessus = differentes.filter((p) => p.s >= SEUIL_QUASI_IDENTIQUE);
const plusProches = [...differentes].sort((x, y) => y.s - x.s).slice(0, 25);
const entreFamilles = differentes.filter((p) => !p.meme_famille).sort((x, y) => y.s - x.s);

// ── 2. Des reformulations écrites à la main (doivent passer le seuil) ──
const REFORMULATIONS: Array<[string, string]> = [
  ['Bonjour Marie, votre rendez-vous est confirmé pour demain 9 h. Merci !', 'Bonjour Marie, votre rendez-vous est bien confirmé pour demain à 9 h. Merci.'],
  ['Bonjour Marie, la facture F-0042 de 517,39 $ est en retard. Merci de la régler ici : https://app.exemple.test/invoice/11111111-1111-4111-8111-111111111111', 'Bonjour Marie, la facture F-0042 de 517,39 $ est toujours en retard. Merci de la régler ici : https://app.exemple.test/invoice/11111111-1111-4111-8111-111111111111'],
  ['Bonjour Marie, merci d’avoir choisi Lavage Éclair. À bientôt !', 'Bonjour Marie ! Merci d’avoir choisi Lavage Éclair, à bientôt.'],
  ['Rappel : votre rendez-vous Lavage de vitres est prévu le 14 octobre 2026 à 09 h 00.', 'Petit rappel : votre rendez-vous Lavage de vitres est prévu le 14 octobre 2026 à 09 h 00. À demain !'],
  // Reformulation LOURDE, même facture : seul le lien commun la rattrape.
  ['Bonjour Marie, la facture F-0042 est en retard de 3 jours. Payez ici : https://app.exemple.test/invoice/11111111-1111-4111-8111-111111111111', 'Marie, un mot pour vous dire que votre solde reste impayé. Le règlement se fait en ligne : https://app.exemple.test/invoice/11111111-1111-4111-8111-111111111111'],
];
// ── 3. Des messages réellement différents pour le même client le même jour (ne doivent PAS passer) ──
const DIFFERENTS: Array<[string, string]> = [
  ['Bonjour Marie, merci d’avoir choisi Lavage Éclair aujourd’hui.', 'Bonjour Marie, comment s’est passé votre lavage ? Laissez-nous un avis : https://app.exemple.test/survey/33333333-3333-4333-8333-333333333333'],
  ['Votre rendez-vous Lavage de vitres est confirmé pour le 14 octobre 2026 à 09 h 00.', 'Votre facture F-0042 de 517,39 $ est prête. Payez ici : https://app.exemple.test/invoice/11111111-1111-4111-8111-111111111111'],
  ['Bonjour Marie, votre rendez-vous est confirmé pour le 14 octobre 2026 à 09 h 00, au 120 rue Principale.', 'Bonjour Marie, notre technicien arrive dans 2 heures au 120 rue Principale. À tantôt !'],
  ['Bonjour Marie, la facture F-0042 de 517,39 $ est en retard.', 'Bonjour Marie, la facture F-0043 de 250,00 $ est en retard.'],
];
const mesurer = (liste: Array<[string, string]>) => liste.map(([a, b]) => ({ a, b, s: Math.round(similarite(a, b) * 100) / 100, meme_lien: liensDe(a).some((l) => liensDe(b).includes(l)) }));

const sortie = {
  seuil: SEUIL_QUASI_IDENTIQUE,
  corpus: { messages: corpus.length, textos: corpus.filter((m) => m.canal === 'texto').length, courriels: corpus.filter((m) => m.canal === 'courriel').length },
  paires: { total: paires.length, differentes: differentes.length, identiques: paires.length - differentes.length },
  paires_differentes_au_dessus_du_seuil: auDessus,
  entre_familles_differentes: { paires: entreFamilles.length, similarite_max: entreFamilles[0]?.s ?? 0, au_dessus_du_seuil: entreFamilles.filter((p) => p.s >= SEUIL_QUASI_IDENTIQUE).length, les_10_plus_proches: entreFamilles.slice(0, 10) },
  les_25_paires_differentes_les_plus_proches: plusProches,
  reformulations: mesurer(REFORMULATIONS),
  reellement_differents: mesurer(DIFFERENTS),
};
mkdirSync('D:/lume-final/sorties/e', { recursive: true });
writeFileSync('D:/lume-final/sorties/e/analyse-similarite.json', JSON.stringify(sortie, null, 2));
console.log(JSON.stringify({ corpus: sortie.corpus, paires: sortie.paires, au_dessus_du_seuil: auDessus.length, dont_meme_famille: auDessus.filter((p) => p.meme_famille).length, entre_familles_max: entreFamilles[0]?.s }, null, 2));
console.log('\nEntre familles différentes, les plus proches :');
for (const p of entreFamilles.slice(0, 6)) console.log(`  ${p.s.toFixed(2)}  ${p.canal.padEnd(8)} ${p.a}  ↔  ${p.b}`);
console.log('\nPaires différentes les plus proches :');
for (const p of plusProches.slice(0, 18)) console.log(`  ${p.s.toFixed(2)}  ${p.canal.padEnd(8)} ${p.meme_declencheur ? 'même décl.' : '          '} ${p.meme_lien ? 'même lien' : '         '}  ${p.a}  ↔  ${p.b}`);
console.log('\nReformulations (attendu ≥ seuil, ou même lien) :');
for (const r of sortie.reformulations) console.log(`  ${r.s.toFixed(2)} ${r.meme_lien ? 'même lien' : '         '}  ${r.a.slice(0, 60)}…`);
console.log('\nRéellement différents (attendu < seuil et pas le même lien) :');
for (const r of sortie.reellement_differents) console.log(`  ${r.s.toFixed(2)} ${r.meme_lien ? 'même lien' : '         '}  ${r.a.slice(0, 50)}… / ${r.b.slice(0, 50)}…`);
