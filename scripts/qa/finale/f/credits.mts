/* ═══════════════════════════════════════════════════════════════
   Agent F — crédits Lumi sur les deux chemins des automatisations.

   Bureau B du jeu « f » (jamais le A, qui sert aux mesures de coût). Pile
   locale seulement.

     QA_AUTO_SUFFIXE=f npx tsx --env-file=.env.local scripts/qa/finale/f/credits.mts

   1. Solde : ce que rend l'API (`GET /api/lumi/credits`) = ce que dit la base
      (`lumi_credits_utilises`), pour les bureaux A et B.
   2. Épuisement en deux paliers, par une ligne ajoutée au grand livre du
      bureau B (le grand livre est en ajout seul : c'est la seule façon) :
      a) 3 100 ¢ dépensés  → les 1 000 crédits (30 $) sont consommés ;
      b) 4 600 ¢ dépensés  → au-delà de l'ancien plafond en dollars (45 $).
      À chaque palier : une création par le clavardage, une création par le
      panneau de l'éditeur, et une action rapide (activer une automatisation).
      On relève le message lu, le code HTTP, et ce qui a été débité.
   3. Aucun montant en dollars dans ce que ces appels renvoient au navigateur.

   Sortie : D:/lume-final/sorties/f-credits.json.
   ═══════════════════════════════════════════════════════════════ */
import { writeFileSync } from 'node:fs';
import { preparer, clavarder, deciderCarte, genererPanneau, creditsVus, repere, releve, SORTIES, n, type Session } from './commun.mts';

const atelier = await preparer();
const { admin, orgA, orgB } = atelier;
const sA: Session = { jeton: atelier.jetonA, orgId: orgA };
const sB: Session = { jeton: atelier.jetonB, orgId: orgB };
const ARGENT = /\$|¢|\bcents?\b|\bdollars?\b|cost_cents|depense_cents|budget_cents/i;

const sortie: Record<string, unknown> = { quand: new Date().toISOString(), orgA, orgB };

/* ── 1. Solde vu par l'API = solde en base ── */
async function solde(s: Session) {
  const vu = await creditsVus(s);
  const { data: micro, error } = await admin.rpc('lumi_credits_utilises', { p_org: s.orgId });
  if (error) throw new Error(`lumi_credits_utilises : ${error.message}`);
  const { data: lignes } = await admin.from('ai_usage').select('credits_micro, cost_cents, source').eq('org_id', s.orgId);
  const sommeMicro = (lignes ?? []).filter((l: any) => (l.source ?? 'lumi') !== 'support').reduce((x: number, l: any) => x + n(l.credits_micro), 0);
  const sommeCents = (lignes ?? []).reduce((x: number, l: any) => x + n(l.cost_cents), 0);
  return {
    api: vu,
    base_micro_credits_rpc: n(micro),
    grand_livre_micro_credits: sommeMicro,
    grand_livre_cents: Math.round(sommeCents * 10_000) / 10_000,
    utilises_attendus: Math.floor(n(micro) / 1_000_000),
    restants_attendus: Math.floor(Math.max(0, n(vu.total) * 1_000_000 - n(micro)) / 1_000_000),
    accord: vu.utilises === Math.floor(n(micro) / 1_000_000) && vu.restants === Math.floor(Math.max(0, n(vu.total) * 1_000_000 - n(micro)) / 1_000_000),
    utilises_plus_restants: n(vu.utilises) + n(vu.restants),
  };
}
sortie.solde_bureau_A = await solde(sA);
sortie.solde_bureau_B_avant = await solde(sB);
console.log('Solde A :', JSON.stringify(sortie.solde_bureau_A));
console.log('Solde B (avant) :', JSON.stringify(sortie.solde_bureau_B_avant));

/* ── Une automatisation à activer dans le bureau B (action rapide, sans modèle) ── */
const NOM = 'Rappel de facture F (bureau B)';
await admin.from('automation_rules').update({ deleted_at: new Date().toISOString(), is_active: false }).eq('org_id', orgB).eq('name', NOM).is('deleted_at', null);
const { error: eSemis } = await admin.from('automation_rules').insert({
  org_id: orgB, name: NOM, description: '', trigger_event: 'invoice.overdue', conditions: {}, delay_seconds: 0, actions: [], is_active: false,
  steps: [
    { id: 'e1', type: 'attendre', delai_secondes: 604_800, suivant: 'e2' },
    { id: 'e2', type: 'action', action: { type: 'send_sms', config: { body: 'Bonjour [client_first_name], votre facture [invoice_number] est en retard : [invoice_link]. Merci, [company_name]' } }, suivant: null },
  ],
});
if (eSemis) throw new Error(`semis bureau B : ${eSemis.message}`);

async function depenseDuBureauB(): Promise<number> {
  const { data } = await admin.from('ai_usage').select('cost_cents').eq('org_id', orgB);
  return (data ?? []).reduce((x: number, l: any) => x + n(l.cost_cents), 0);
}
/** Porte la dépense du bureau B à `cible` cents, par une ligne d'essai au grand livre. */
async function porterA(cible: number): Promise<number> {
  const deja = await depenseDuBureauB();
  const manque = Math.round((cible - deja) * 10_000) / 10_000;
  if (manque > 0) {
    const { error } = await admin.from('ai_usage').insert({
      org_id: orgB, user_id: null, conversation_id: null, model: 'claude-sonnet-5', source: 'lumi',
      input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0,
      cost_cents: manque, request_id: `qa-f-epuisement-${cible}-${Date.now()}`,
    });
    if (error) throw new Error(`ligne d’épuisement : ${error.message}`);
  }
  return depenseDuBureauB();
}

async function palier(nom: string, cible: number) {
  const depense = await porterA(cible);
  const vu = await creditsVus(sB);
  const r: Record<string, unknown> = { depense_cents: Math.round(depense * 100) / 100, credits_vus: vu };

  // a) Création par le clavardage.
  let depuis = await repere(admin, orgB);
  const chat = await clavarder(sB, 'Crée une automatisation : quand une facture est payée, envoie un texto de remerciement au client.');
  let carte: Record<string, unknown> | null = null;
  if (chat.proposition && chat.conversation_id) {
    // Lumi a quand même proposé une carte : on la confirme pour voir si la création part (et si elle est débitée).
    const e = await deciderCarte(sB, chat.conversation_id, chat.proposition.tool_use_id, 'confirm');
    carte = { outil: chat.proposition.tool, statut: e.statut, texte: e.texte.slice(0, 400), executes: e.executes };
  }
  let ecrit = await releve(admin, orgB, depuis);
  r.clavardage = {
    statut_http: chat.statut, texte: chat.texte.slice(0, 400), erreur: chat.erreur, carte, etage: chat.etage, credits_dans_la_reponse: chat.credits,
    appels_modele: ecrit.usage.length, debite_cents: Math.round(ecrit.usage.reduce((x, l) => x + n(l.cost_cents), 0) * 10_000) / 10_000,
    trace: ecrit.traces.map((t) => ({ etage: t.etage, action: t.action, resultat: t.resultat, cout: t.cost_cents })),
    argent_dans_le_flux: (chat.brut.match(new RegExp(`.{0,40}(${ARGENT.source}).{0,40}`, 'gi')) ?? []).slice(0, 5),
  };

  // b) Création par le panneau de l'éditeur.
  depuis = await repere(admin, orgB);
  const panneau = await genererPanneau(sB, 'Quand une facture est payée, envoie un texto de remerciement au client.');
  ecrit = await releve(admin, orgB, depuis, false);
  r.panneau = {
    statut_http: panneau.statut, message: String(panneau.corps?.error ?? panneau.corps?.resume ?? '').slice(0, 400), etapes: Array.isArray(panneau.corps?.steps) ? panneau.corps!.steps.length : 0,
    appels_modele: ecrit.usage.length, debite_cents: Math.round(ecrit.usage.reduce((x, l) => x + n(l.cost_cents), 0) * 10_000) / 10_000,
    argent_dans_la_reponse: (panneau.brut.match(new RegExp(`.{0,40}(${ARGENT.source}).{0,40}`, 'gi')) ?? []).slice(0, 5),
  };

  // c) Action rapide (sans modèle) : doit marcher même à zéro crédit.
  depuis = await repere(admin, orgB);
  const rapide = await clavarder(sB, `Active l’automatisation ${NOM}`);
  let confirme: Record<string, unknown> | null = null;
  if (rapide.proposition && rapide.conversation_id) {
    const e = await deciderCarte(sB, rapide.conversation_id, rapide.proposition.tool_use_id, 'cancel');
    confirme = { statut: e.statut, texte: e.texte.slice(0, 200) };
  }
  ecrit = await releve(admin, orgB, depuis);
  r.action_rapide = { statut_http: rapide.statut, texte: rapide.texte.slice(0, 300), carte: rapide.proposition?.tool ?? null, annulee: confirme, appels_modele: ecrit.usage.length, etage: rapide.etage };

  sortie[nom] = r;
  console.log(`\n=== ${nom} — dépense ${r.depense_cents} ¢, crédits vus ${JSON.stringify(vu)} ===`);
  console.log('clavardage :', JSON.stringify(r.clavardage));
  console.log('panneau    :', JSON.stringify(r.panneau));
  console.log('rapide     :', JSON.stringify(r.action_rapide));
}

await palier('palier_1_credits_epuises_3100_cents', 3_100);
await palier('palier_2_au_dela_de_45_dollars_4600_cents', 4_600);
sortie.solde_bureau_B_apres = await solde(sB);
writeFileSync(`${SORTIES}/f-credits.json`, JSON.stringify(sortie, null, 1));
console.log('\nSolde B (après) :', JSON.stringify(sortie.solde_bureau_B_apres));
process.exit(0);
