/**
 * Inventaire des tokens envoyés au modèle par Lumi et par l'agent de support.
 * ─────────────────────────────────────────────────────────────────────────
 *   node --env-file=<.env.local> --import tsx scripts/qa/lumi/compter-tokens.mts [--sortie <dossier>]
 *
 * Ce que fait ce script :
 *   1. importe les VRAIS constructeurs du serveur (promptSystemeLumi, outilsClaude,
 *      outilsDuSousAgent, outilsPermis, PROMPT_ROUTEUR, repondreSupportIA…) ;
 *   2. CAPTURE les vraies requêtes : `messages.create` et `messages.stream` du
 *      client partagé (server/lib/lumi/llm.ts) sont remplacés par un bouchon
 *      local qui enregistre les paramètres et rend une réponse factice. Les
 *      fonctions du serveur (tourLumi, repondreSupportIA, classifier) tournent
 *      donc telles quelles, mais RIEN ne part vers l'API de génération ;
 *   3. mesure chaque morceau avec `messages.countTokens` (gratuit, aucune
 *      génération) sur un second client, non bouchonné.
 *
 * Ce qu'il ne fait pas : aucun `messages.create` réel, aucune écriture en base,
 * aucun serveur lancé. Le contexte du tour (entreprise, prénom, souvenirs) que
 * la route lit en base (server/routes/lumi.ts, contexteTour) est remplacé par
 * des valeurs d'exemple : c'est le seul endroit où l'assemblage est RECONSTRUIT.
 *
 * Méthode de mesure :
 *   - « base » = une requête avec le seul message « x », sans outil ni prompt ;
 *   - un bloc de prompt = compte(avec le bloc) − base ;
 *   - un jeu d'outils = compte(avec le jeu) − base (inclut le préambule que
 *     l'API ajoute dès qu'il y a au moins un outil) ;
 *   - UN outil = compte([pivot, outil]) − compte([pivot]) : son coût marginal,
 *     sans le préambule. « pivot » est un outil minimal, toujours le même.
 */
import Anthropic from '@anthropic-ai/sdk';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { clientAnthropic } from '../../../server/lib/lumi/llm';
import { outilsClaude, promptSystemeLumi, tourLumi, OUTILS_DE_BASE, OUTIL_RECHERCHE } from '../../../server/lib/lumi/orchestrateur';
import { outilsDuSousAgent, focusDuSousAgent, estSousAgent, OUTILS_TRANSVERSES } from '../../../server/lib/lumi/sous-agents';
import { TOPICS, topicDeLOutil, type IdTopic } from '../../../server/lib/lumi/topics';
import { AGENT_TOOLS, TOOLS_BY_NAME } from '../../../server/lib/agent/tools';
import { OUTILS_LECTURE_ETENDUS, OUTILS_ECRITURE_ETENDUS } from '../../../server/lib/agent/tools-etendus';
import { OUTILS_RAPPORTS } from '../../../server/lib/agent/tools-rapports';
import { OUTILS_LEADS } from '../../../server/lib/agent/tools-leads';
import { OUTILS_ARGENT } from '../../../server/lib/agent/tools-argent';
import { OUTILS_TERRAIN } from '../../../server/lib/agent/tools-terrain';
import { OUTILS_EQUIPE } from '../../../server/lib/agent/tools-equipe';
import { OUTILS_REGLAGES } from '../../../server/lib/agent/tools-reglages';
import { OUTILS_D2D_FORMATIONS } from '../../../server/lib/agent/tools-d2d-formations';
import { PERMISSION_PAR_OUTIL, OUTILS_FINANCIERS, outilsPermis, restrictionsDe } from '../../../server/lib/agent/garde';
import { REGISTRE_ECRITURES, JAMAIS_D_OFFICE } from '../../../server/lib/agent/registre';
import { allegerSchema } from '../../../server/lib/lumi/alleger-outils';
import { MODELE_PAR_DEFAUT, modeleLumi } from '../../../server/lib/lumi/tarifs';
import { reglagesPourPalier } from '../../../server/lib/lumi/budget';
import { reglesCout } from '../../../server/lib/lumi/regles-cout';
import { maintenantPourLumi } from '../../../server/lib/lumi/temps';
import { indiceOutils } from '../../../server/lib/lumi/indices-outils';
import { PROMPT_ROUTEUR, MODELE_ROUTEUR, classifier, modeRouteur } from '../../../server/lib/lumi/routeur';
import { VERSION_PROMPT, empreintePrompt } from '../../../server/lib/lumi/version';
import { consignesSms } from '../../../server/lib/sms/lumi-sms';
import { MODELE_SUPPORT, promptsPourMesure, repondreSupportIA } from '../../../server/lib/support/ia';
import { chercherAide } from '../../../server/lib/agent/tools-aide';
import { indexCarteApp, CARTE_APP } from '../../../server/lib/support/carte-app';
import { ARTICLES } from '../../../src/components/supportArticles';
import { SYSTEM_PROMPT as PROMPT_VENTE } from '../../../server/lib/agent/promptVente';
import { CONSIGNES_COLLEGUE } from '../../../server/lib/agent/consignesCollegue';
import { ENONCES_EXACTS } from '../../../server/lib/lumi/raccourcis';
import type { UserContext } from '../../../server/lib/rbac';

// ── Sortie ──────────────────────────────────────────────────────
const iSortie = process.argv.indexOf('--sortie');
const SORTIE = iSortie > -1 ? path.resolve(process.argv[iSortie + 1]) : null;
if (SORTIE) mkdirSync(SORTIE, { recursive: true });
const ecrire = (nom: string, contenu: string) => { if (SORTIE) writeFileSync(path.join(SORTIE, nom), contenu, 'utf8'); };

if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY absente : lance avec --env-file.'); process.exit(1); }

// ── 1. Bouchon de capture : aucune génération ne part ───────────
type Capture = { via: 'create' | 'stream'; params: any };
const captures: Capture[] = [];
const reponseFactice = (model: string) => ({
  id: 'msg_capture', type: 'message', role: 'assistant', model,
  content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', stop_sequence: null,
  usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
});
const partage = clientAnthropic() as any;
const bouchonCreate = async (params: any) => { captures.push({ via: 'create', params }); return reponseFactice(params.model); };
const bouchonStream = (params: any) => {
  captures.push({ via: 'stream', params });
  const flux = { on: () => flux, finalMessage: async () => reponseFactice(params.model) };
  return flux;
};
partage.messages.create = bouchonCreate;
partage.messages.stream = bouchonStream;
if (clientAnthropic().messages.create !== bouchonCreate || (clientAnthropic().messages as any).stream !== bouchonStream) {
  console.error('Le bouchon de capture n\'est pas en place : arrêt (aucune génération ne doit partir).');
  process.exit(1);
}
/** Lance `f` et rend la dernière requête que le serveur AURAIT envoyée. */
async function capturer(f: () => Promise<unknown>): Promise<Capture> {
  const avant = captures.length;
  await f();
  if (captures.length !== avant + 1) throw new Error(`capture : ${captures.length - avant} requête(s) au lieu d'une`);
  return captures[captures.length - 1];
}

// ── 2. Comptage (second client, jamais bouchonné, countTokens seulement) ──
const compteur = new Anthropic({ maxRetries: 6 });
const memo = new Map<string, Promise<number>>();
let appels = 0;
const MESSAGE_X: Anthropic.Messages.MessageParam[] = [{ role: 'user', content: 'x' }];
function compter(model: string, p: { system?: any; tools?: any[]; messages?: any[]; thinking?: any; tool_choice?: any; output_config?: any }): Promise<number> {
  const corps: any = { model, messages: p.messages ?? MESSAGE_X };
  if (p.system !== undefined) corps.system = p.system;
  if (p.tools?.length) corps.tools = p.tools;
  if (p.thinking) corps.thinking = p.thinking;
  if (p.tool_choice) corps.tool_choice = p.tool_choice;
  if (p.output_config) corps.output_config = p.output_config;
  const cle = JSON.stringify(corps);
  let r = memo.get(cle);
  if (!r) {
    appels++;
    r = compteur.messages.countTokens(corps).then((x) => x.input_tokens);
    memo.set(cle, r);
  }
  return r;
}
/** Exécute par lots (l'API de comptage a sa propre limite de débit). */
async function parLots<T, R>(items: T[], taille: number, f: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let curseur = 0;
  await Promise.all(Array.from({ length: Math.min(taille, items.length) }, async () => {
    while (curseur < items.length) { const i = curseur++; out[i] = await f(items[i], i); }
  }));
  return out;
}

// ── 3. Modèles ──────────────────────────────────────────────────
const MODELE = MODELE_PAR_DEFAUT; // le défaut du code (tarifs.ts), pas la variable LUMI_MODEL de l'environnement
const MODELE_HAIKU = reglagesPourPalier('econome', MODELE).model; // paliers économe / restreint
const modeles = { lumi_defaut: MODELE, lumi_env: modeleLumi(), lumi_paliers_degrades: MODELE_HAIKU, routeur: MODELE_ROUTEUR, support: MODELE_SUPPORT };

// ── 4. Outils : forme envoyée, attributs, coût marginal ─────────
const PIVOT = { name: 'pivot', description: 'x', input_schema: { type: 'object', properties: {} } };
const formeEnvoyee = (nom: string) => {
  const t = TOOLS_BY_NAME[nom];
  return { name: t.declaration.name, description: t.declaration.description, input_schema: allegerSchema(t.declaration.parameters ?? { type: 'object', properties: {} }) };
};
const formeBrute = (nom: string) => {
  const t = TOOLS_BY_NAME[nom];
  return { name: t.declaration.name, description: t.declaration.description, input_schema: t.declaration.parameters ?? { type: 'object', properties: {} } };
};
const MODULES: Array<[string, Array<{ declaration: { name: string } }>]> = [
  ['tools-etendus (lecture)', OUTILS_LECTURE_ETENDUS], ['tools-etendus (écriture)', OUTILS_ECRITURE_ETENDUS], ['tools-rapports', OUTILS_RAPPORTS],
  ['tools-leads', OUTILS_LEADS], ['tools-argent', OUTILS_ARGENT], ['tools-terrain', OUTILS_TERRAIN], ['tools-equipe', OUTILS_EQUIPE],
  ['tools-reglages', OUTILS_REGLAGES], ['tools-d2d-formations', OUTILS_D2D_FORMATIONS],
];
const moduleDe = (nom: string): string => {
  if (nom === 'search_help') return 'tools-aide';
  for (const [m, liste] of MODULES) if (liste.some((t) => t.declaration.name === nom)) return m;
  return 'tools (cœur)';
};
const SOUS_AGENTS = TOPICS.map((t) => t.id).filter((id) => estSousAgent(id)) as IdTopic[];
const nomsTous = AGENT_TOOLS.map((t) => t.declaration.name);
const uneLigne = (s: string) => { const l = s.replace(/\s+/g, ' ').trim(); const fin = l.search(/[.!?](\s|$)/); const p = fin > 20 ? l.slice(0, fin + 1) : l; return p.length > 160 ? p.slice(0, 157) + '…' : p; };

console.error(`[compter-tokens] ${nomsTous.length} outils, ${SOUS_AGENTS.length} sous-agents, modèle ${MODELE}`);

const base0 = await compter(MODELE, {});
const pivotSeul = await compter(MODELE, { tools: [PIVOT] });
const marginaux = await parLots(nomsTous, 6, (n) => compter(MODELE, { tools: [PIVOT, formeEnvoyee(n)] }).then((v) => v - pivotSeul));
const outilRecherche = (await compter(MODELE, { tools: [PIVOT, OUTIL_RECHERCHE] })) - pivotSeul;

const lignesOutils = nomsTous.map((nom, i) => {
  const t = TOOLS_BY_NAME[nom];
  const schema = formeEnvoyee(nom).input_schema as any;
  const reg = REGISTRE_ECRITURES[nom];
  return {
    nom,
    tokens: marginaux[i],
    genre: t.kind,
    permission: PERMISSION_PAR_OUTIL[nom]?.cle ?? null,
    financier: OUTILS_FINANCIERS.has(nom),
    topic: topicDeLOutil(nom),
    transverse: OUTILS_TRANSVERSES.includes(nom),
    module: moduleDe(nom),
    base: OUTILS_DE_BASE.has(nom),
    noyau: TOPICS.filter((x) => x.noyau?.includes(nom)).map((x) => x.id),
    sous_agents: SOUS_AGENTS.filter((id) => outilsDuSousAgent(id).includes(nom)),
    sensible: reg?.sensible ?? null,
    jamais_d_office: JAMAIS_D_OFFICE.has(nom),
    vers_client: reg?.vers_client ?? null,
    parametres: Object.keys(schema?.properties ?? {}).length,
    car_description: t.declaration.description.length,
    car_schema: JSON.stringify(schema).length,
    car_schema_brut: JSON.stringify(t.declaration.parameters ?? {}).length,
    description: uneLigne(t.declaration.description),
  };
});

// ── 5. Jeux d'outils ────────────────────────────────────────────
async function mesurerJeu(model: string, envoye: any[]) {
  const sansType = envoye.filter((t) => !t.type) as any[];
  const charges = sansType.filter((t) => !t.defer_loading).map(({ cache_control, ...r }) => r);
  const differes = sansType.filter((t) => t.defer_loading);
  const b = await compter(model, {});
  const [telEnvoye, chargesSeuls, chargesEtRecherche] = await Promise.all([
    compter(model, { tools: envoye }).then((v) => v - b),
    compter(model, { tools: charges }).then((v) => v - b),
    compter(model, { tools: [OUTIL_RECHERCHE, ...charges] }).then((v) => v - b),
  ]);
  return { nb_charges: charges.length, nb_differes: differes.length, noms_charges: charges.map((t) => t.name), tokens_tel_qu_envoye: telEnvoye, tokens_charges_seuls: chargesSeuls, tokens_charges_plus_recherche: chargesEtRecherche };
}
const tousCharges = nomsTous.map(formeEnvoyee);
const tousBruts = nomsTous.map(formeBrute);
const jeuComplet = {
  nb: nomsTous.length,
  tokens_alleges: (await compter(MODELE, { tools: tousCharges })) - base0,
  tokens_bruts: (await compter(MODELE, { tools: tousBruts })) - base0,
  tokens_alleges_haiku: (await compter(MODELE_HAIKU, { tools: tousCharges })) - (await compter(MODELE_HAIKU, {})),
  somme_marginaux: marginaux.reduce((s, v) => s + v, 0),
  preambule_outils: pivotSeul - base0, // préambule de l'API + l'outil pivot lui-même
};
const jeux: Record<string, any> = {};
jeux['base'] = await mesurerJeu(MODELE, outilsClaude(null, null));
for (const id of SOUS_AGENTS) jeux[`sous-agent:${id}`] = await mesurerJeu(MODELE, outilsClaude(id, null));
jeux['base (Haiku, paliers économe/restreint)'] = await mesurerJeu(MODELE_HAIKU, outilsClaude(null, null));

// Rôles : ce que le filtre RBAC (garde.ts outilsPermis) laisse au modèle.
const ctxRole = (role: UserContext['role']): UserContext => ({ userId: 'u', orgId: 'o', role, scope: 'company', teamId: null, departmentId: null, managerId: null, permissions: {} });
const ROLES: Array<{ cle: string; role: UserContext['role']; montants: boolean }> = [
  { cle: 'owner', role: 'owner', montants: true },
  { cle: 'admin', role: 'admin', montants: true },
  { cle: 'sales_rep (voit les montants)', role: 'sales_rep', montants: true },
  { cle: 'sales_rep (montants masqués)', role: 'sales_rep', montants: false },
  { cle: 'technician', role: 'technician', montants: false },
];
const roles: Record<string, any> = {};
for (const r of ROLES) {
  const permis = outilsPermis(ctxRole(r.role), r.montants);
  const m = await mesurerJeu(MODELE, outilsClaude(null, permis));
  roles[r.cle] = { nb_permis: permis.size, ...m, restrictions: restrictionsDe(ctxRole(r.role), r.montants, 'fr') };
}

// ── 6. Prompt système de Lumi ───────────────────────────────────
const INSTANT = new Date('2026-10-01T18:32:00Z');
const todayIso = maintenantPourLumi('America/Toronto', 'fr', INSTANT);
const ctxExemple = { companyName: 'Entreprise Exemple inc.', userName: 'Prénom Nom', language: 'fr' as const, todayIso };
const souvenirsTypiques = [
  { key: 'prix_lavage_vitres', value: 'Lavage de vitres résidentiel : 180 $ pour un bungalow, 260 $ pour un cottage.' },
  { key: 'jours_travail', value: 'On ne travaille jamais le dimanche ; le samedi seulement en haute saison.' },
  { key: 'client_tremblay', value: 'Marie Tremblay préfère les textos aux appels et paie toujours par virement.' },
  { key: 'acompte', value: 'Acompte de 30 % demandé pour tout devis au-dessus de 1 000 $.' },
  { key: 'equipe_marc', value: 'Marc fait les gouttières, Antoine les vitres en hauteur.' },
];
const souvenirsMax = Array.from({ length: 30 }, (_, i) => ({ key: `note_${i + 1}`, value: 'Le client préfère être appelé en fin de journée, paie par virement et demande toujours un devis écrit avant. '.repeat(3) }));
const blocs = promptSystemeLumi(ctxExemple);
const stable = blocs[0].text;
const tokensSysteme = async (model: string, texte: string) => (await compter(model, { system: texte })) - (await compter(model, {}));
const variableDe = (extra: Record<string, any>) => promptSystemeLumi({ ...ctxExemple, ...extra })[1].text;
const promptLumi: Record<string, any> = {
  version: VERSION_PROMPT,
  empreinte_bloc_stable: empreintePrompt(stable),
  car_stable: stable.length,
  tokens_stable: await tokensSysteme(MODELE, stable),
  tokens_stable_haiku: await tokensSysteme(MODELE_HAIKU, stable),
  tokens_stable_en_identique: promptSystemeLumi({ ...ctxExemple, language: 'en' })[0].text === stable,
  variable: {} as Record<string, any>,
};
const variantes: Array<[string, string]> = [
  ['minimal (langue, entreprise, date-heure, prénom)', variableDe({})],
  ['+ 5 souvenirs typiques', variableDe({ souvenirs: souvenirsTypiques })],
  ['+ 30 souvenirs au plafond (240 car. chacun)', variableDe({ souvenirs: souvenirsMax })],
  ['+ restrictions du rôle technicien', variableDe({ restrictions: restrictionsDe(ctxRole('technician'), false, 'fr') })],
  ['+ consignes SMS (canal texto)', variableDe({ focus: consignesSms('fr') })],
  ['anglais, minimal', promptSystemeLumi({ ...ctxExemple, language: 'en', todayIso: maintenantPourLumi('America/Toronto', 'en', INSTANT) })[1].text],
];
for (const id of SOUS_AGENTS) variantes.push([`+ focus sous-agent ${id}`, variableDe({ focus: focusDuSousAgent(id, 'fr') })]);
const ENONCES = ['mes factures en retard', 'pointe-moi', 'crée un devis pour Tremblay, lavage de vitres 250 $', 'combien de maisons cognées cette semaine'];
for (const e of ENONCES) {
  const indice = indiceOutils(e, 'fr', OUTILS_DE_BASE);
  variantes.push([`+ indice d'outils pour « ${e} »`, variableDe({ focus: indice })]);
}
for (const [nom, texte] of variantes) promptLumi.variable[nom] = { car: texte.length, tokens: await tokensSysteme(MODELE, texte), texte };
// Poids de chaque section du bloc stable (découpé aux titres « # ») : chaque section comptée seule.
promptLumi.sections = [];
for (const sec of stable.split(/\n(?=# )/)) {
  const titre = sec.startsWith('# ') ? sec.split('\n')[0] : '(en-tête : identité)';
  promptLumi.sections.push({ titre, car: sec.length, tokens: await tokensSysteme(MODELE, sec) });
}
promptLumi.tokens_consignes_collegue = await tokensSysteme(MODELE, CONSIGNES_COLLEGUE);

// ── 7. Requêtes complètes de Lumi, capturées dans tourLumi ──────
async function requeteLumi(nom: string, o: { sousAgent?: IdTopic | null; permis?: ReadonlySet<string> | null; palier?: 'normal' | 'econome'; extra?: Record<string, any> }) {
  const reglages = reglagesPourPalier(o.palier ?? 'normal', MODELE);
  // Même assemblage que server/routes/lumi.ts:433-439 (focus du sous-agent dans le bloc variable).
  const focus = o.sousAgent ? focusDuSousAgent(o.sousAgent, 'fr') : null;
  const systeme = promptSystemeLumi({ ...ctxExemple, ...(o.extra ?? {}), ...(focus ? { focus } : {}) });
  const c = await capturer(() => tourLumi({
    client: null as any, orgId: 'org', userId: 'user', systeme,
    historique: [{ role: 'user', content: 'x' }],
    emettre: () => {}, journaliser: async () => {},
    sousAgent: o.sousAgent ?? null, outilsPermis: o.permis ?? null,
    reglages: { model: reglages.model, effort: reglages.effort, max_etapes: reglages.max_etapes },
  }));
  const p = c.params;
  const b = await compter(p.model, {});
  const avecReflexion = await compter(p.model, { system: p.system, tools: p.tools, messages: p.messages, thinking: p.thinking, output_config: p.output_config }).catch(() => null);
  const total = await compter(p.model, { system: p.system, tools: p.tools, messages: p.messages });
  const outils = (await compter(p.model, { tools: p.tools })) - b;
  const sysStable = (await compter(p.model, { system: [p.system[0]] })) - b;
  const sysTout = (await compter(p.model, { system: p.system })) - b;
  const pointsDeCache = [
    ...p.tools.map((t: any, i: number) => (t.cache_control ? `tools[${i}] ${t.name} (${JSON.stringify(t.cache_control)})` : null)),
    ...p.system.map((s: any, i: number) => (s.cache_control ? `system[${i}] (${JSON.stringify(s.cache_control)})` : null)),
    ...p.messages.flatMap((m: any, i: number) => (Array.isArray(m.content) ? m.content.map((bl: any, j: number) => (bl.cache_control ? `messages[${i}].content[${j}] (${JSON.stringify(bl.cache_control)})` : null)) : [])),
  ].filter(Boolean);
  return {
    nom, via: c.via, model: p.model, max_tokens: p.max_tokens, thinking: p.thinking ?? null, output_config: p.output_config ?? null,
    nb_outils_envoyes: p.tools.length, nb_charges: p.tools.filter((t: any) => !t.type && !t.defer_loading).length, nb_differes: p.tools.filter((t: any) => t.defer_loading).length,
    points_de_cache: pointsDeCache,
    tokens: { base_message_x: b, outils_tel_qu_envoye: outils, systeme_stable: sysStable, systeme_variable: sysTout - sysStable, total, total_avec_reflexion: avecReflexion },
  };
}
const requetes: any[] = [];
const permisOwner = outilsPermis(ctxRole('owner'), true);
requetes.push(await requeteLumi('chat — jeu de base, propriétaire', { permis: permisOwner }));
for (const id of SOUS_AGENTS) requetes.push(await requeteLumi(`chat — sous-agent ${id}, propriétaire`, { sousAgent: id, permis: permisOwner }));
requetes.push(await requeteLumi('chat — jeu de base, technicien (RBAC)', { permis: outilsPermis(ctxRole('technician'), false), extra: { restrictions: restrictionsDe(ctxRole('technician'), false, 'fr') } }));
requetes.push(await requeteLumi('chat — jeu de base, propriétaire, 30 souvenirs', { permis: permisOwner, extra: { souvenirs: souvenirsMax } }));
requetes.push(await requeteLumi('texto (lumi-sms) — jeu de base, sans filtre RBAC', { permis: null, extra: { focus: consignesSms('fr') } }));
requetes.push(await requeteLumi('chat — palier économe (Haiku), jeu de base', { permis: permisOwner, palier: 'econome' }));

// Modèle : le même jeu de base compté avec d'autres modèles (le tokenizer dépend du modèle).
const parModele: Record<string, any> = {};
for (const m of [...new Set([MODELE, 'claude-opus-5', MODELE_HAIKU, modeleLumi()])]) {
  const b = await compter(m, {});
  parModele[m] = {
    systeme_stable: (await compter(m, { system: stable })) - b,
    outils_base_tel_qu_envoye: (await compter(m, { tools: outilsClaude(null, null) })) - b,
    jeu_complet_charge: (await compter(m, { tools: tousCharges })) - b,
  };
}

// ── 8. Routeur (Haiku) ──────────────────────────────────────────
const capRouteur = await capturer(() => classifier('mes factures en retard'));
const bR = await compter(MODELE_ROUTEUR, {});
const routeur = {
  mode_env: modeRouteur(), model: capRouteur.params.model, max_tokens: capRouteur.params.max_tokens,
  car_prompt: PROMPT_ROUTEUR.length,
  tokens_prompt: (await compter(MODELE_ROUTEUR, { system: PROMPT_ROUTEUR })) - bR,
  tokens_outil_classer: (await compter(MODELE_ROUTEUR, { tools: capRouteur.params.tools })) - bR,
  tokens_total: await compter(MODELE_ROUTEUR, { system: capRouteur.params.system, tools: capRouteur.params.tools, tool_choice: capRouteur.params.tool_choice, messages: capRouteur.params.messages }),
  points_de_cache: capRouteur.params.system.filter((s: any) => s.cache_control).map((s: any) => JSON.stringify(s.cache_control)),
  // Deux listes générées dans le prompt (reconstruites ici comme dans routeur.ts) : noms d'outils par topic, énoncés exacts.
  tokens_liste_outils_par_topic: (await compter(MODELE_ROUTEUR, { system: TOPICS.filter((t) => t.outils.length).map((t) => `- ${t.id} : ${t.outils.join(', ')}`).join('\n') })) - bR,
  tokens_liste_enonces_exacts: (await compter(MODELE_ROUTEUR, { system: ENONCES_EXACTS.map(([e, a]) => `- « ${e} » → ${a.id}${a.periode ? `, periode ${a.periode}` : ''}`).join('\n') })) - bR,
  definition_outil: capRouteur.params.tools,
};

// ── 9. Agent de support ─────────────────────────────────────────
const DOSSIER = `Entreprise : Plomberie Tremblay — compte créé le 2026-03-02 (197 jours), 5 employés déclarés.
Abonnement : forfait Scale, statut active, mensuel, période en cours jusqu'au 2026-10-02.
Réglages : configuration initiale terminée, industrie plomberie, Québec, fuseau America/Toronto, langue fr ; avis Google configurés.
Personnes : 4 utilisateurs (1 owner, 1 admin, 2 technician), 6 membres d'équipe terrain.
Données : 212 clients, 340 jobs, 88 devis, 260 factures ; 9 factures avec un solde dû.
Automatisations : 12 règles, 9 actives.
Paiements : Stripe activé, PayPal non activé, défaut stripe ; Lume Payments (Stripe Connect) : inscription terminée, encaissements actifs, virements actifs.
Migration de données : aucune migration en cours ni passée.
Demandes de support récentes : « Comment changer mon forfait ? » (fermée, 2026-09-10).`;
// Les outils que chaque surface fournit réellement : app = statut + démarrage (server/routes/support.ts:169-170),
// portail = statut seul (server/lib/support/portail.ts:61), site public = aucun (server/routes/sales-chat.ts:103).
const OUTILS_SUPPORT = {
  app: { statutMigration: async () => '', demarrerMigration: async () => ({ ok: false as const, raison: '' }) },
  migration_portal: { statutMigration: async () => '' },
  public: {},
};
const support: Record<string, any> = { model: MODELE_SUPPORT, requetes: [] as any[], recherche_aide: [] as any[] };
const bS = await compter(MODELE_SUPPORT, {});
for (const surface of ['app', 'migration_portal', 'public'] as const) {
  for (const langue of ['fr', 'en'] as const) {
    const c = await capturer(() => repondreSupportIA(
      { langue, companyName: 'Entreprise Exemple inc.', planLabel: 'Scale', userName: 'Prénom Nom', slaTexte: '4 heures ouvrables', surface, dossier: surface === 'public' ? null : DOSSIER, page: surface === 'app' ? '/jobs' : null },
      [], 'x', OUTILS_SUPPORT[surface],
    ));
    const p = c.params;
    const sysStable = (await compter(p.model, { system: [p.system[0]] })) - bS;
    const sysTout = (await compter(p.model, { system: p.system })) - bS;
    support.requetes.push({
      surface, langue, via: c.via, model: p.model, max_tokens: p.max_tokens, thinking: p.thinking ?? null, output_config: p.output_config ?? null,
      outils: p.tools.map((t: any) => t.name),
      points_de_cache: [
        ...p.tools.map((t: any, i: number) => (t.cache_control ? `tools[${i}]` : null)),
        ...p.system.map((s: any, i: number) => (s.cache_control ? `system[${i}] (${JSON.stringify(s.cache_control)})` : null)),
      ].filter(Boolean),
      car_stable: p.system[0].text.length, car_variable: p.system[1]?.text.length ?? 0,
      tokens: {
        outils: (await compter(p.model, { tools: p.tools })) - bS,
        systeme_stable: sysStable, systeme_variable: sysTout - sysStable,
        total: await compter(p.model, { system: p.system, tools: p.tools, messages: p.messages }),
        // Préfixe mis en cache (outils + bloc stable) s'il tournait sur Haiku 4.5 (LUMI_SUPPORT_MODELE) : seuil de cache 4 096.
        prefixe_cache_si_haiku: (await compter(MODELE_HAIKU, { system: [p.system[0]], tools: p.tools })) - (await compter(MODELE_HAIKU, {})),
      },
      textes: { stable: p.system[0].text, variable: p.system[1]?.text ?? '' },
      definitions_outils: p.tools,
    });
  }
}
// Poids des morceaux injectés dans le bloc stable du support (reconstruits comme dans ia.ts:94-96 et :131-134).
support.parties = {
  index_carte_app: { car: indexCarteApp().length, tokens: (await compter(MODELE_SUPPORT, { system: indexCarteApp() })) - bS },
  sujets_faq_fr: { nb: ARTICLES.length, tokens: (await compter(MODELE_SUPPORT, { system: ARTICLES.map((a) => a.q_fr).join(' · ') })) - bS },
  sujets_faq_en: { nb: ARTICLES.length, tokens: (await compter(MODELE_SUPPORT, { system: ARTICLES.map((a) => a.q_en).join(' · ') })) - bS },
  prompt_vente_public: { car: PROMPT_VENTE.length, tokens: (await compter(MODELE_SUPPORT, { system: PROMPT_VENTE })) - bS },
  // Hors prompt depuis le 2026-09-17 : la carte complète, servie par search_help.
  carte_app_complete_hors_prompt: { car: CARTE_APP.length, tokens: (await compter(MODELE_SUPPORT, { system: CARTE_APP })) - bS },
};
// Vérification : la fonction de mesure exportée par ia.ts rend le même bloc stable que la vraie requête.
support.coherence_promptsPourMesure = promptsPourMesure('fr', 'app', DOSSIER).stable === support.requetes.find((r: any) => r.surface === 'app' && r.langue === 'fr').textes.stable;
// Ce que search_help renvoie (résultat d'outil, ajouté à la conversation) — sans le savoir d'équipe, qui vit en base.
for (const q of ['comment envoyer une facture', 'où changer mon forfait', 'comment supprimer une tâche', 'ajouter un membre à mon équipe']) {
  const passages = chercherAide(q, 3);
  const contenu = JSON.stringify({ count: passages.length, passages });
  support.recherche_aide.push({ question: q, passages: passages.length, car: contenu.length, tokens: (await compter(MODELE_SUPPORT, { messages: [{ role: 'user', content: contenu }] })) - bS + 1 });
}

// ── 10. Sorties ─────────────────────────────────────────────────
const resultat = {
  genere_le: new Date().toISOString(), modeles, base_message_x: base0, appels_count_tokens: appels,
  regles_cout: reglesCout(),
  jeu_complet: jeuComplet, outil_recherche_tokens: outilRecherche, jeux, roles, par_modele: parModele,
  prompt_lumi: promptLumi, requetes_lumi: requetes, routeur, support,
  outils: lignesOutils,
  sous_agents: Object.fromEntries(SOUS_AGENTS.map((id) => [id, { outils: outilsDuSousAgent(id), noyau: TOPICS.find((t) => t.id === id)?.noyau ?? [] }])),
  outils_de_base: [...OUTILS_DE_BASE], outils_transverses: [...OUTILS_TRANSVERSES],
};
ecrire('compter-tokens.json', JSON.stringify(resultat, null, 2));
ecrire('prompt-lumi-stable.txt', stable);
ecrire('prompt-lumi-variable-exemple.txt', promptSystemeLumi({ ...ctxExemple, souvenirs: souvenirsTypiques, restrictions: restrictionsDe(ctxRole('technician'), false, 'fr'), focus: focusDuSousAgent('facturation', 'fr') })[1].text);
ecrire('prompt-routeur.txt', PROMPT_ROUTEUR);
for (const r of support.requetes) {
  ecrire(`prompt-support-${r.surface}-${r.langue}-stable.txt`, r.textes.stable);
  if (r.textes.variable) ecrire(`prompt-support-${r.surface}-${r.langue}-variable.txt`, r.textes.variable);
}

const f = (n: number | null | undefined) => (n == null ? '—' : String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' '));
console.log(`\nModèles : ${JSON.stringify(modeles)}`);
console.log(`Appels count_tokens : ${appels} ; base (message « x ») : ${base0} tokens\n`);
console.log('PROMPT LUMI');
console.log(`  bloc stable (${promptLumi.version}, ${promptLumi.empreinte_bloc_stable}) : ${f(promptLumi.tokens_stable)} tokens (${f(promptLumi.car_stable)} car.) ; Haiku : ${f(promptLumi.tokens_stable_haiku)}`);
for (const [nom, v] of Object.entries(promptLumi.variable) as Array<[string, any]>) console.log(`  bloc variable ${nom} : ${f(v.tokens)} tokens`);
console.log('\nOUTILS — jeux');
console.log(`  jeu complet chargé (${jeuComplet.nb} outils) : ${f(jeuComplet.tokens_alleges)} tokens allégés, ${f(jeuComplet.tokens_bruts)} bruts ; somme des coûts marginaux ${f(jeuComplet.somme_marginaux)} ; outil de recherche ${f(outilRecherche)}`);
for (const [nom, j] of Object.entries(jeux) as Array<[string, any]>) console.log(`  ${nom} : ${j.nb_charges} chargés + ${j.nb_differes} différés → tel qu'envoyé ${f(j.tokens_tel_qu_envoye)} ; chargés seuls ${f(j.tokens_charges_seuls)} ; chargés + recherche ${f(j.tokens_charges_plus_recherche)}`);
console.log('\nOUTILS — par rôle (jeu de base)');
for (const [nom, r] of Object.entries(roles) as Array<[string, any]>) console.log(`  ${nom} : ${r.nb_permis} permis, ${r.nb_charges} chargés + ${r.nb_differes} différés → ${f(r.tokens_tel_qu_envoye)} tokens`);
console.log('\nREQUÊTES LUMI (capturées dans tourLumi)');
for (const r of requetes) console.log(`  ${r.nom} [${r.model}] : total ${f(r.tokens.total)} (avec réflexion ${f(r.tokens.total_avec_reflexion)}) = outils ${f(r.tokens.outils_tel_qu_envoye)} + stable ${f(r.tokens.systeme_stable)} + variable ${f(r.tokens.systeme_variable)} + base ${r.tokens.base_message_x} ; cache : ${r.points_de_cache.join(' | ')}`);
console.log('\nPAR MODÈLE');
for (const [m, v] of Object.entries(parModele) as Array<[string, any]>) console.log(`  ${m} : stable ${f(v.systeme_stable)} ; outils base ${f(v.outils_base_tel_qu_envoye)} ; jeu complet ${f(v.jeu_complet_charge)}`);
console.log(`\nROUTEUR [${routeur.model}, LUMI_ROUTEUR=${routeur.mode_env}] : prompt ${f(routeur.tokens_prompt)} + outil ${f(routeur.tokens_outil_classer)} → total ${f(routeur.tokens_total)}`);
console.log('\nSUPPORT');
for (const r of support.requetes) console.log(`  ${r.surface}/${r.langue} [${r.model}] : total ${f(r.tokens.total)} = outils ${f(r.tokens.outils)} (${r.outils.join(', ')}) + stable ${f(r.tokens.systeme_stable)} + variable ${f(r.tokens.systeme_variable)} ; préfixe en cache si Haiku ${f(r.tokens.prefixe_cache_si_haiku)} ; cache : ${r.points_de_cache.join(' | ')}`);
for (const r of support.recherche_aide) console.log(`  search_help « ${r.question} » : ${r.passages} passages, ${f(r.tokens)} tokens`);
console.log('\n25 PLUS GROS OUTILS (coût marginal, forme envoyée)');
for (const l of [...lignesOutils].sort((a, b) => b.tokens - a.tokens).slice(0, 25)) console.log(`  ${String(l.tokens).padStart(5)}  ${l.nom}  [${l.genre}, ${l.topic ?? 'transverse'}, ${l.module}]`);
if (SORTIE) console.log(`\nDétail écrit dans ${SORTIE}`);
process.exit(0);
