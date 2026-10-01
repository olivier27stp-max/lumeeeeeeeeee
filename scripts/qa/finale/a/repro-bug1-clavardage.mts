/**
 * Reproduction du bug n° 1, chemin (b) : le CLAVARDAGE GÉNÉRAL de Lumi (POST /api/lumi/chat,
 * vrai modèle), avec les outils update_automation_message / update_automation_sms_body.
 *
 *   QA_AUTO_SUFFIXE=a npx tsx --env-file=.env.local scripts/qa/finale/a/repro-bug1-clavardage.mts ["demande"] ["réponse si Lumi pose une question"]
 *
 * La règle est montée dans l'état que l'éditeur produit (steps = texto d'exemple,
 * actions = « À compléter »). Pour chaque tour : texte de Lumi, outils appelés, carte de
 * confirmation, puis la base (steps ET actions) avant / après « Confirmer ».
 * Sortie : D:/lume-final/sorties/a/repro-bug1-clavardage.json
 */
import { admin, bureauA, demanderALumi, deciderCarte, depenseDepuis, ecrireSortie, lireRegle, marque, messagesDe, nettoyer, sessionApi } from './outils.mts';

const DEMANDE = process.argv[2] ?? 'change le message de l’automatisation';
const PRECISION = process.argv[3] ?? 'celle des factures en retard : mets un texto de relance poli avec le lien de paiement';
const M = marque('bug1-chat');
const b = await bureauA();
const debut = new Date().toISOString();
const trace: Array<Record<string, unknown>> = [];
const noter = (etape: string, d: Record<string, unknown>) => { trace.push({ etape, ...d }); console.log(`\n── ${etape}\n${JSON.stringify(d, null, 1).slice(0, 3000)}`); };

const { data: regle, error } = await admin.from('automation_rules').insert({
  org_id: b.orgA, name: `${M} Relance facture en retard`, trigger_event: 'invoice.overdue', conditions: {}, delay_seconds: 0, is_active: false,
  actions: [{ type: 'send_sms', config: { body: 'À compléter' } }],
  steps: [{ id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'Bonjour [client_name], c’est [company_name]. Merci !' } }, suivant: null }],
}).select('id').single();
if (error) throw new Error(error.message);
const id = regle.id as string;
const base = async () => { const r = await lireRegle(id); return { ...messagesDe(r), updated_at: r.updated_at, is_active: r.is_active }; };

try {
  const s = await sessionApi('fr');
  noter('0. règle montée', { id, base: await base() });
  let r = await demanderALumi(s, DEMANDE);
  noter('1. demande', { demande: DEMANDE, statut: r.statut, texte: r.texte, outils: r.outils, proposition: r.proposition, executes: r.executes, erreur: r.erreur, base: await base() });
  let conv = r.conversation_id;
  if (!r.proposition && conv && !r.executes.length) {
    r = await demanderALumi(s, PRECISION, conv);
    noter('2. précision', { demande: PRECISION, texte: r.texte, outils: r.outils, proposition: r.proposition, executes: r.executes, erreur: r.erreur, base: await base() });
  }
  if (r.proposition && conv) {
    const avant = await base();
    const c = await deciderCarte(s, conv, r.proposition.tool_use_id, 'confirm');
    noter('3. « Confirmer » la carte', { outil: r.proposition.tool, args: r.proposition.args, texte_apres: c.texte, executes: c.executes, evenements: c.evenements.filter((e) => e.type !== 'tool'), avant, apres: await base() });
  }
  // Ce que les traces et le journal d'actions gardent.
  const { data: traces } = await admin.from('lumi_traces').select('etage, topic, action, outils, resultat, model, input_tokens, cache_lu, cache_5m, output_tokens, cost_cents, duree_ms').eq('org_id', b.orgA).gte('created_at', debut).order('created_at');
  const { data: actions } = await admin.from('agent_actions').select('outil, resultat, created_at').eq('org_id', b.orgA).gte('created_at', debut).order('created_at');
  noter('4. lumi_traces', { traces });
  noter('5. agent_actions (journal des actions de l’agent)', { actions });
  noter('6. coût', await depenseDepuis(b.orgA, debut));
} finally {
  console.log('sortie :', ecrireSortie(`repro-bug1-clavardage${process.env.QA_A_SUFFIXE_SORTIE ?? ''}.json`, trace));
  if (!process.env.QA_A_GARDER) await nettoyer(M);
}
