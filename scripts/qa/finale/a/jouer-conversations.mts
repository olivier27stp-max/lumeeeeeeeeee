/**
 * Joue des conversations avec Lumi sur les automatisations — VRAI modèle, API locale — et
 * vérifie CHAQUE tour en base (mission, points 1 et 3).
 *
 *   QA_AUTO_SUFFIXE=a npx tsx --env-file=.env.local scripts/qa/finale/a/jouer-conversations.mts --scenarios C01,C08
 *   QA_AUTO_SUFFIXE=a npx tsx --env-file=.env.local scripts/qa/finale/a/jouer-conversations.mts --demandes D01,D15
 *
 * Données : tests/automations-finale/a/scenarios-conversation.json et demandes-modification.json.
 * Chaque tour coûte un appel au modèle : on ne joue que ce qu'on nomme (aucun « tout » par défaut).
 *
 * Deux canaux, joués comme l'interface les joue :
 *   · « panneau »    : POST /api/automations/rules/generer avec ce que l'éditeur envoie (les 6
 *                      derniers échanges, le parcours à l'écran, l'id de la règle), puis les DEUX
 *                      écritures que l'éditeur fait après la réponse (déclencheur s'il change, puis
 *                      `{ name, steps }` — l'enregistrement automatique). Un message de moins de
 *                      10 caractères n'est PAS envoyé : le bouton de l'éditeur est grisé.
 *   · « clavardage » : POST /api/lumi/chat, puis /api/lumi/execute si le tour dit « decision ».
 *
 * Avant chaque scénario : les automatisations non fournies du bureau A (a) sont purgées, la langue
 * revient à « fr », la pause générale est levée. Sortie : D:/lume-final/sorties/a/conversations-*.json
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { variablesInconnues } from '../../../../src/lib/emailBodyText';
import { trouverDeclencheur } from '../../../../src/lib/automationCatalogue';
import { admin, appelApi, bureauA, deciderCarte, demanderALumi, depenseDepuis, ecrireSortie, genererParcours, lireRegle, nettoyerDepuis, sessionApi, type LigneRegle, type SessionApi } from './outils.mts';
import { semer } from './semer.mts';

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > -1 ? (process.argv[i + 1] ?? '') : ''; };
const idsScenarios = arg('--scenarios').split(',').filter(Boolean);
const idsDemandes = arg('--demandes').split(',').filter(Boolean);
if (!idsScenarios.length && !idsDemandes.length) {
  console.error('Nomme ce que tu joues : --scenarios C01,C02 ou --demandes D01,D02 (chaque tour coûte un appel au modèle).');
  process.exit(2);
}
const DOSSIER = join(process.cwd(), 'tests/automations-finale/a');
const fichierScenarios = JSON.parse(readFileSync(join(DOSSIER, 'scenarios-conversation.json'), 'utf8'));
const fichierDemandes = JSON.parse(readFileSync(join(DOSSIER, 'demandes-modification.json'), 'utf8'));
const BIBLIO = fichierScenarios.regles as Record<string, { nom: string; declencheur: string; actions: unknown[]; steps: unknown[] }>;

interface Verif { type: string; [k: string]: any }
interface Tour { dit: string; decision?: 'confirm' | 'cancel'; attend: Verif[] }
interface Scenario { id: string; langue: 'fr' | 'en'; canal: 'panneau' | 'clavardage'; titre?: string; montage: string[]; ouverte?: string; active?: string[]; tours: Tour[] }

const aJouer: Scenario[] = [
  ...(fichierScenarios.scenarios as Scenario[]).filter((s) => idsScenarios.includes(s.id)),
  ...(fichierDemandes.demandes as any[]).filter((d) => idsDemandes.includes(d.id)).map((d) => ({ ...d, titre: d.dit, tours: [{ dit: d.dit, decision: d.decision, attend: d.attend }] }) as Scenario),
];

const b = await bureauA();
await semer();
const norm = (t: string) => String(t ?? '').replace(/[’‘]/g, "'").replace(/[«»“”"]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const messages = (r: LigneRegle | null, canal: string) => (r?.steps ?? []).filter((e) => e?.type === 'action' && e.action?.type === canal).map((e) => ({ corps: String(e.action?.config?.body ?? ''), objet: String(e.action?.config?.subject ?? '') }));
const sansBalises = (t: string) => t.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const instantane = (r: LigneRegle | null) => (r ? JSON.stringify({ name: r.name, trigger_event: r.trigger_event, conditions: r.conditions, steps: r.steps, actions: r.actions, settings: r.settings, is_active: r.is_active, deleted_at: !!r.deleted_at }) : 'absente');
const reglages = async () => (await admin.from('company_settings').select('default_language, automations_paused').eq('org_id', b.orgA).single()).data as { default_language: string; automations_paused: boolean };
const horsPreset = async () => ((await admin.from('automation_rules').select('id, name, deleted_at').eq('org_id', b.orgA).eq('is_preset', false).is('purged_at', null)).data ?? []) as Array<{ id: string; name: string; deleted_at: string | null }>;
// « Non plus, malheureusement — … mais pas déclencher un appel téléphonique » dit bien que c'est impossible :
// la passe finale l'avait compté comme une faute (C09 T2). Ajoutés : « non plus », « mais pas », « ne peuvent pas ».
const IMPOSSIBLE = /\bnon plus\b|\bmais pas\b|ne (peuvent|savent) pas|ne (peux|peut|sais|sait) pas|pas (possible|disponible|encore|offert|pris en charge)|n.existe pas|impossible|n.est pas (offert|pris en charge|disponible|possible)|ne (fait|font|gère|gèrent|permet|permettent) pas|can.?t|cannot|not (available|possible|supported|able)|isn.?t (available|possible|supported)|don.?t (have|support)|doesn.?t (exist|support)|unable/i;
const estAnglais = (t: string) => (t.match(/\b(the|is|are|your|you|it|this|and|of|will|i've|i)\b/gi)?.length ?? 0) > (t.match(/\b(le|la|les|des|est|une|pour|avec|dans|ton|ta|tu|je|j'ai|c'est|ça)\b/gi)?.length ?? 0);

const bilan: Array<Record<string, any>> = [];
const debutPasse = new Date().toISOString();

for (const sc of aJouer) {
  // ── Montage ──
  await nettoyerDepuis('2000-01-01T00:00:00Z');
  await admin.from('company_settings').update({ default_language: 'fr', automations_paused: false }).eq('org_id', b.orgA);
  const ids: Record<string, string> = {};
  for (const cle of sc.montage) {
    const m = BIBLIO[cle];
    const { data, error } = await admin.from('automation_rules').insert({
      org_id: b.orgA, name: m.nom, trigger_event: m.declencheur, conditions: {}, delay_seconds: 0,
      is_active: (sc.active ?? []).includes(cle), actions: m.actions, steps: m.steps,
    }).select('id').single();
    if (error) throw new Error(`montage ${cle} : ${error.message}`);
    ids[cle] = data.id as string;
  }
  const lire = async () => Object.fromEntries(await Promise.all(Object.entries(ids).map(async ([c, id]) => [c, await lireRegle(id)]))) as Record<string, LigneRegle>;
  const montageInitial = await lire();
  const s: SessionApi = await sessionApi(sc.langue);
  const debut = new Date().toISOString();
  let conv: string | null = null;
  const echanges: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  console.log(`\n══ ${sc.id} [${sc.canal}, ${sc.langue}] ${sc.titre ?? ''}`);
  const toursJoues: Array<Record<string, any>> = [];

  for (const [i, tour] of sc.tours.entries()) {
    const avant = await lire();
    const reglagesAvant = await reglages();
    const horsAvant = await horsPreset();
    let reponse = ''; let outils: string[] = []; let carte: { tool: string; args: Record<string, unknown> } | null = null; let executes: unknown[] = []; let nonEnvoyable = false;

    if (sc.canal === 'panneau') {
      const ouverte = avant[sc.ouverte ?? sc.montage[0]];
      // L'éditeur n'exige 10 caractères que pour la PREMIÈRE demande (ClavardageLumi.tsx, A-12) :
      // dans une conversation en cours, « oui » ou « active-la » partent.
      if (tour.dit.trim().length < (echanges.length > 0 ? 1 : 10)) {
        nonEnvoyable = true;
        reponse = '(NON ENVOYÉ : le bouton « Construire » de l’éditeur reste grisé sous 10 caractères pour une première demande)';
      } else {
        const steps = ouverte.steps ?? [];
        const r = await genererParcours(s, { demande: tour.dit, echanges: echanges.slice(-6), parcours_actuel: steps.length ? { trigger_event: ouverte.trigger_event, steps } : null, rule_id: ouverte.id });
        if (r.statut === 200) {
          reponse = String(r.json.resume ?? '');
          // Ce que l'éditeur écrit après la réponse (AutomationBuilderPage.construireAvecLumi + enregistrement automatique).
          if (r.json.trigger_event && r.json.trigger_event !== ouverte.trigger_event) await appelApi(s, 'PATCH', `/api/automations/rules/${ouverte.id}`, { trigger_event: r.json.trigger_event });
          const p = await appelApi(s, 'PATCH', `/api/automations/rules/${ouverte.id}`, { name: r.json.nom || ouverte.name, steps: r.json.steps });
          if (p.statut !== 200) reponse += `\n(ENREGISTREMENT REFUSÉ ${p.statut} : ${JSON.stringify(p.json).slice(0, 200)})`;
          echanges.push({ role: 'user', content: tour.dit }, { role: 'assistant', content: reponse });
        } else {
          reponse = `(${r.statut}) ${String(r.json?.error ?? JSON.stringify(r.json))}`;
        }
      }
    } else {
      // « ouverte » dans le clavardage : l'utilisateur vient de l'éditeur de cette automatisation
      // (lien /lumi?automatisation=<id>) — la page Lumi envoie ce repère avec chaque message.
      const page = sc.ouverte && ids[sc.ouverte] ? { type: 'automatisation' as const, rule_id: ids[sc.ouverte] } : null;
      const r = await demanderALumi(s, tour.dit, conv, page);
      conv = r.conversation_id ?? conv;
      reponse = r.erreur ? `(ERREUR ${r.statut}) ${JSON.stringify(r.erreur).slice(0, 300)}` : r.texte;
      outils = r.outils;
      executes = r.executes;
      carte = r.proposition ? { tool: r.proposition.tool, args: r.proposition.args } : null;
      if (r.proposition && tour.decision && conv) {
        const c = await deciderCarte(s, conv, r.proposition.tool_use_id, tour.decision);
        reponse += `\n[carte ${r.proposition.tool} → ${tour.decision}] ${c.erreur ? JSON.stringify(c.erreur).slice(0, 200) : c.texte}`;
        executes = [...executes, ...c.executes];
      }
    }

    const apres = await lire();
    const reglagesApres = await reglages();
    const horsApres = await horsPreset();
    const nouvelles = horsApres.filter((x) => !horsAvant.some((y) => y.id === x.id));

    // ── Vérifications ──
    const resultats: Array<{ verif: string; ok: boolean; detail: string }> = [];
    const noter = (v: Verif, ok: boolean, detail: string) => resultats.push({ verif: `${v.type}${v.regle ? `(${v.regle})` : ''}`, ok, detail });
    for (const v of tour.attend) {
      const rA = v.regle ? avant[v.regle] : null; const rZ = v.regle ? apres[v.regle] : null; const r0 = v.regle ? montageInitial[v.regle] : null;
      if (v.type === 'texte') {
        const n = (v.numero ?? 1) - 1;
        const mA = messages(rA, v.canal)[n]; const mZ = messages(rZ, v.canal)[n]; const m0 = messages(r0, v.canal)[n];
        if (!mZ) { noter(v, false, `aucun message ${v.canal} n° ${n + 1} dans le parcours`); continue; }
        const pb: string[] = [];
        if (v.change && mA && mZ.corps === mA.corps) pb.push('le texte n’a pas changé en base');
        if (v.inchange && mA && (mZ.corps !== mA.corps || mZ.objet !== mA.objet)) pb.push(`le texte a changé : « ${mZ.corps.slice(0, 80)} »`);
        if (v.corps_inchange && mA && mZ.corps !== mA.corps) pb.push('le corps a changé alors que seul l’objet était demandé');
        if (v.plus_court && mA && !(sansBalises(mZ.corps).length < sansBalises(mA.corps).length)) pb.push(`pas plus court (${sansBalises(mA.corps).length} → ${sansBalises(mZ.corps).length} caractères)`);
        if (v.max_caracteres && sansBalises(mZ.corps).length > v.max_caracteres) pb.push(`${sansBalises(mZ.corps).length} caractères > ${v.max_caracteres}`);
        for (const c of v.contient ?? []) if (!norm(mZ.corps).includes(norm(c))) pb.push(`ne contient pas « ${c} »`);
        for (const c of v.ne_contient_pas ?? []) if (norm(mZ.corps).includes(norm(c))) pb.push(`contient encore « ${c} »`);
        if (v.egal !== undefined && norm(mZ.corps) !== norm(v.egal)) pb.push(`texte en base « ${mZ.corps.slice(0, 120)} » ≠ demandé`);
        if (v.egal_au_montage && m0 && norm(mZ.corps) !== norm(m0.corps)) pb.push(`texte en base « ${mZ.corps.slice(0, 100)} » ≠ texte d’origine`);
        if (v.objet_contient && !norm(mZ.objet).includes(norm(v.objet_contient))) pb.push(`objet « ${mZ.objet} »`);
        noter(v, pb.length === 0, pb.join(' ; ') || `« ${sansBalises(mZ.corps).slice(0, 110)} »`);
      } else if (v.type === 'etape') {
        const trouvees = (rZ?.steps ?? []).filter((e) => e.type === v.etape && (v.delai_secondes === undefined || Number(e.delai_secondes) === v.delai_secondes));
        const ok = v.absente ? trouvees.length === 0 : trouvees.length > 0;
        noter(v, ok, ok ? 'présente' : `étapes en base : ${JSON.stringify((rZ?.steps ?? []).map((e) => (e.type === 'attendre' ? `attendre ${e.delai_secondes}s` : e.type === 'action' ? e.action?.type : e.type)))}`);
      } else if (v.type === 'nb_messages') {
        const n = messages(rZ, v.canal).length;
        noter(v, n === v.egal, `${n} message(s) ${v.canal}`);
      } else if (v.type === 'champ') {
        const val = (r: LigneRegle | null) => (v.champ === 'deleted' ? !!r?.deleted_at : (r as any)?.[v.champ]);
        const z = val(rZ);
        const ok = v.inchange ? JSON.stringify(z) === JSON.stringify(val(rA)) : v.contient !== undefined ? norm(String(z)).includes(norm(v.contient)) : z === v.egal;
        noter(v, ok, `${v.champ} = ${JSON.stringify(z)}${v.inchange ? ` (avant : ${JSON.stringify(val(rA))})` : ''}`);
      } else if (v.type === 'ciblage') {
        const ou = JSON.stringify({ conditions: rZ?.conditions, settings: rZ?.settings, si: (rZ?.steps ?? []).filter((e) => e.type === 'si').map((e) => e.conditions) });
        noter(v, norm(ou).includes(norm(v.contient)), `conditions, réglages et étapes « si » en base : ${ou.slice(0, 200)}`);
      } else if (v.type === 'variables_connues') {
        const textes = (rZ?.steps ?? []).filter((e) => e.type === 'action').flatMap((e) => [String(e.action?.config?.body ?? ''), String(e.action?.config?.subject ?? '')]).join('\n');
        const inconnues = variablesInconnues(textes);
        noter(v, inconnues.length === 0, inconnues.length ? `variables inconnues : ${inconnues.join(', ')}` : 'toutes connues');
      } else if (v.type === 'reflet') {
        const corpsSteps = [...messages(rZ, 'send_sms'), ...messages(rZ, 'send_email')].map((m) => m.corps);
        const corpsActions = (rZ?.actions ?? []).filter((a) => ['send_sms', 'send_email'].includes(a.type)).map((a) => String(a.config?.body ?? ''));
        const orphelins = corpsActions.filter((c) => !corpsSteps.includes(c));
        noter(v, orphelins.length === 0, orphelins.length ? `\`actions\` porte un texte que \`steps\` n’a pas : « ${orphelins[0].slice(0, 80)} »` : '`actions` ne contredit pas `steps`');
      } else if (v.type === 'aucune_ecriture') {
        const changees = Object.keys(ids).filter((c) => instantane(avant[c]) !== instantane(apres[c]));
        const pb = [...changees.map((c) => `règle « ${c} » modifiée`), ...nouvelles.map((n) => `règle créée : ${n.name}`), ...(JSON.stringify(reglagesAvant) !== JSON.stringify(reglagesApres) ? ['réglages modifiés'] : [])];
        noter(v, pb.length === 0, pb.join(' ; ') || 'rien n’a bougé');
      } else if (v.type === 'carte') {
        noter(v, !!carte === !!v.attendue, carte ? `carte ${carte.tool}` : 'aucune carte');
      } else if (v.type === 'journal') {
        const { data } = await admin.from('agent_actions').select('outil').eq('org_id', b.orgA).gte('created_at', debut);
        const ok = (data ?? []).some((a) => String(a.outil).startsWith(v.outil));
        noter(v, ok, `agent_actions depuis le début : ${(data ?? []).map((a) => a.outil).join(', ') || '(vide)'}`);
      } else if (v.type === 'copie' || v.type === 'texte_copie') {
        const horsMontage = horsApres.filter((x) => !Object.values(ids).includes(x.id) && !x.deleted_at && norm(x.name).includes(norm(montageInitial[v.de].name).slice(0, 12)));
        if (!horsMontage.length) { noter(v, false, 'aucune copie en base'); continue; }
        const copie = await lireRegle(horsMontage[0].id);
        if (v.type === 'copie') noter(v, copie.is_active === false, `copie « ${copie.name} », is_active = ${copie.is_active}`);
        else {
          const m = messages(copie, v.canal)[0];
          const pb = (v.contient ?? []).filter((c: string) => !norm(m?.corps ?? '').includes(norm(c)));
          noter(v, pb.length === 0, `copie : « ${(m?.corps ?? '').slice(0, 110)} »`);
        }
      } else if (v.type === 'reglage') {
        noter(v, (reglagesApres as any)[v.champ] === v.egal, `${v.champ} = ${JSON.stringify((reglagesApres as any)[v.champ])}`);
      } else if (v.type === 'reponse') {
        const pb: string[] = [];
        for (const c of v.contient ?? []) if (!new RegExp(c, 'i').test(reponse)) pb.push(`ne dit pas /${c}/`);
        for (const c of v.ne_contient_pas ?? []) if (norm(reponse).includes(norm(c))) pb.push(`dit « ${c} »`);
        if (v.questions) { const n = (reponse.match(/\?/g) ?? []).length; if (n < v.questions.min || n > v.questions.max) pb.push(`${n} question(s) (attendu ${v.questions.min}–${v.questions.max})`); }
        if (v.dit_impossible && !IMPOSSIBLE.test(reponse)) pb.push('ne dit pas que c’est impossible');
        // Une fonction pas encore bâtie (cibler un TYPE de client) : UNE question précise, ou un « pas encore possible » honnête.
        if (v.question_ou_impossible) { const n = (reponse.match(/\?/g) ?? []).length; if (!(n === 1 || IMPOSSIBLE.test(reponse))) pb.push(`ni une question précise (${n} « ? »), ni un « pas possible » clair`); }
        if (v.langue === 'en' && !estAnglais(reponse)) pb.push('réponse pas en anglais');
        if (v.cite_le_texte_enregistre) {
          const m = messages(apres[v.cite_le_texte_enregistre], 'send_sms')[0] ?? messages(apres[v.cite_le_texte_enregistre], 'send_email')[0];
          const debutTexte = norm(sansBalises(m?.corps ?? '')).slice(0, 45);
          if (!debutTexte || !norm(reponse).includes(debutTexte)) pb.push(`ne cite pas le texte enregistré en base (« ${sansBalises(m?.corps ?? '').slice(0, 60)}… »)`);
        }
        if (v.resume_avant_activation) {
          const r = apres[v.resume_avant_activation];
          const decl = trouverDeclencheur(r.trigger_event);
          const m = messages(r, 'send_sms')[0] ?? messages(r, 'send_email')[0];
          const manque: string[] = [];
          if (!(decl && (norm(reponse).includes(norm(decl.fr)) || norm(reponse).includes(norm(decl.en))))) manque.push('le déclencheur');
          if (!norm(reponse).includes(norm(sansBalises(m?.corps ?? '')).slice(0, 45))) manque.push('le message exact');
          if (!/\d+\s+(clients?|factures?|invoices?|customers?)/i.test(reponse)) manque.push('le nombre de clients touchés');
          if (manque.length) pb.push(`résumé avant activation sans : ${manque.join(', ')}`);
        }
        noter(v, pb.length === 0, pb.join(' ; ') || 'conforme');
      } else {
        noter(v, false, `vérification inconnue : ${v.type}`);
      }
    }
    const okTour = resultats.every((r) => r.ok);
    console.log(`  ${okTour ? 'PASS' : 'FAIL'}  T${i + 1} « ${tour.dit.slice(0, 70)} »${outils.length ? ` — outils : ${outils.join(', ')}` : ''}${carte ? ` — carte : ${carte.tool}` : ''}${nonEnvoyable ? ' — NON ENVOYABLE' : ''}`);
    console.log(`        Lumi : ${reponse.replace(/\s+/g, ' ').slice(0, 330)}`);
    for (const r of resultats.filter((x) => !x.ok)) console.log(`        ✗ ${r.verif} : ${r.detail}`);
    toursJoues.push({ tour: i + 1, dit: tour.dit, reponse, outils, carte, executes, decision: tour.decision ?? null, non_envoyable: nonEnvoyable, ok: okTour, verifications: resultats });
  }
  const cout = await depenseDepuis(b.orgA, debut);
  const okSc = toursJoues.every((t) => t.ok);
  console.log(`  → ${sc.id} : ${okSc ? 'PASS' : 'FAIL'} (${toursJoues.filter((t) => t.ok).length}/${toursJoues.length} tours), coût ${cout.cents.toFixed(2)} ¢ en ${cout.appels} appels`);
  bilan.push({ id: sc.id, canal: sc.canal, langue: sc.langue, titre: sc.titre, ok: okSc, tours_ok: toursJoues.filter((t) => t.ok).length, tours: toursJoues.length, cout_cents: cout.cents, appels_modele: cout.appels, detail: toursJoues });
}

await nettoyerDepuis('2000-01-01T00:00:00Z');
await admin.from('company_settings').update({ default_language: 'fr', automations_paused: false }).eq('org_id', b.orgA);
const total = await depenseDepuis(b.orgA, debutPasse);
console.log(`\nBILAN : ${bilan.filter((x) => x.ok).length}/${bilan.length} PASS — coût total ${total.cents.toFixed(2)} ¢ (${total.appels} appels au modèle)`);
console.log('sortie :', ecrireSortie(`conversations-${[...idsScenarios, ...idsDemandes].join('_').slice(0, 60)}.json`, { quand: debutPasse, cout_cents: total.cents, appels: total.appels, bilan }));
process.exit(0);
