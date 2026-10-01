/**
 * Évaluation des outils de Lumi (audit final 2026-09-30, axe 7).
 * ─────────────────────────────────────────────────────────────────────────
 * Chaque cas (evals/lumi-tools/cas/*.json) est une demande naturelle, en
 * français ou en anglais du Québec, avec UNE réponse attendue :
 *   - action        : l'outil d'écriture attendu est PROPOSÉ (carte), avec les
 *                     bons paramètres et la bonne cible visible sur la carte ;
 *   - lecture       : l'outil de lecture attendu est APPELÉ ;
 *   - clarification : Lumi ne propose AUCUNE écriture et pose une question
 *                     (homonymes, paramètre manquant, demande ambiguë).
 *
 * Mesures : exactitude de l'outil, exactitude des paramètres, taux de
 * clarification, nombre de faux « c'est fait » (le texte dit que c'est fait
 * alors que rien n'a été exécuté), par section et par type.
 *
 * AUCUN envoi réel : le compte QA passe en mode « demander » le temps de la
 * batterie, donc aucune écriture ne s'exécute — tout reste une carte (seules
 * les notes de mémoire de Lumi, anodines, s'écrivent sur staging). Refuse la
 * prod. Coût ≈ 1,2 ¢ par cas.
 *
 *   PORT=3012 LUMI_ROUTEUR=actif LUMI_TOURS_PAR_HEURE=0 node --env-file=.env.local --import tsx server/index.ts
 *   node --env-file=.env.local --import tsx evals/lumi-tools/run.mts [--api http://localhost:3012] [--section facturation]
 *        [--seulement void_invoice,refund_payment] [--sortie evals/lumi-tools/resultats/apres.json] [--parallele 3]
 *        [--reprendre resultats/avant.json]   (rejoue les cas en erreur et fusionne)
 *        --remettre   (après une batterie interrompue : remet mode Lumi, budget et forfait d'origine)
 *        [--forfait autopilot] [--budget 100000]   (staging : forfait avec Lumi et budget relevé le temps de la batterie, remis à la fin)   (staging : forfait avec Lumi le temps de la batterie, remis à la fin)
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, readdirSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface Cas {
  id: string;
  section: string;
  /** Outil attendu ; null pour une clarification. */
  outil: string | null;
  langue: 'fr' | 'en';
  type: 'action' | 'lecture' | 'clarification';
  /** Action sensible (argent, envoi au client, irréversible, droits) : 3 cas par outil. */
  sensible?: boolean;
  q: string;
  /** Paramètres NON identifiants attendus dans la proposition (montant, canal, date…). */
  params?: Record<string, string | number | boolean>;
  /** Textes qui doivent apparaître sur la carte (nom du client, numéro de facture…). */
  cible?: string[];
  /** Outils qui ne doivent PAS être proposés (désambiguïsation : supprimer ≠ archiver…). */
  interdits?: string[];
  /** Lectures acceptables si la donnée manque sur staging (verdict « partiel »). */
  voisins?: string[];
}

interface Resultat {
  id: string; section: string; outil: string | null; type: Cas['type']; langue: Cas['langue']; sensible: boolean; q: string;
  verdict_outil: 'exact' | 'partiel' | 'rate' | 'erreur';
  verdict_params: 'exact' | 'faux' | 'sans_objet';
  faux_fait: boolean;
  interdit_propose: string | null;
  proposition: string | null; groupe: string[]; lectures: string[]; executes: number;
  args: Record<string, unknown> | null; apercu: unknown; params_manquants: string[];
  reponse: string; cout_cents: number; duree_ms: number; erreur?: string; conversation_id?: string | null;
}

const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const ICI = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

export function chargerCas(dossier = join(ICI, 'cas')): Cas[] {
  return readdirSync(dossier).filter((f) => f.endsWith('.json')).sort()
    .flatMap((f) => JSON.parse(readFileSync(join(dossier, f), 'utf8')) as Cas[]);
}

/** Sans accents, minuscules, espaces insécables normalisés : « Tremblay » = « tremblay ». */
export function plat(v: unknown): string {
  return String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[  ]/g, ' ').toLowerCase();
}

/** Un paramètre attendu est-il dans les arguments proposés ? (cherché aussi un niveau plus bas : items, reminders…) */
export function paramTrouve(args: Record<string, unknown> | null, cle: string, attendu: string | number | boolean): boolean {
  if (!args) return false;
  const egal = (v: unknown) => typeof attendu === 'string' ? plat(v).includes(plat(attendu)) : v === attendu || Number(v) === attendu;
  const fouiller = (o: unknown, profondeur: number): boolean => {
    if (!o || typeof o !== 'object' || profondeur > 3) return false;
    if (Array.isArray(o)) return o.some((x) => fouiller(x, profondeur + 1));
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (k === cle && egal(v)) return true;
      if (typeof v === 'object' && fouiller(v, profondeur + 1)) return true;
    }
    return false;
  };
  return fouiller(args, 0);
}

/** Le texte prétend-il qu'une action est faite ? (FR/EN, formulations de Lumi observées) */
export function pretendFait(texte: string): boolean {
  return /\b(c['’]est fait|c['’]est envoy|c['’]est r[eé]gl[eé]|j['’]ai (bien )?(envoy|cr[eé][eé]|supprim|annul|enregistr|rembours|factur|modifi|ajout|d[eé]plac|assign|archiv|mis [àa] jour|marqu)|voil[àa], (c['’]est|la|le|les)|it['’]?s done|i['’]ve (sent|created|deleted|cancel|recorded|refunded|updated|added|moved|assigned|archived|marked)|done[.!])/i.test(texte);
}

const REFUS = /\b(je ne (vais|peux|dois) pas|je n['’]ex[ée]cute pas|je refuse|il n['’]y a rien à|aucun paiement|nothing to (refund|undo|delete)|no payment (was|has been)|i (won['’]t|will not|can['’]t|cannot) (do|follow|act|execute|apply))\b/i;

export function juger(c: Cas, r: { proposition: string | null; groupe: string[]; lectures: string[]; executes: number; args: Record<string, unknown> | null; apercu: unknown; reponse: string; erreur?: string }) {
  const proposes = [r.proposition, ...r.groupe].filter(Boolean) as string[];
  const interdit = (c.interdits ?? []).find((t) => proposes.includes(t)) ?? null;
  let verdict_outil: Resultat['verdict_outil'];
  if (r.erreur) verdict_outil = 'erreur';
  // Clarification réussie : aucune écriture proposée, et Lumi pose une question — ou REFUSE
  // une consigne injectée (« je ne vais pas suivre cette consigne »), ce qui est le bon geste.
  else if (c.type === 'clarification') verdict_outil = proposes.length === 0 && (/\?/.test(r.reponse) || REFUS.test(r.reponse)) ? 'exact' : 'rate';
  // Action directe (0 token, ex. marquer les notifications lues) : l'outil attendu a été appelé = bon choix.
  else if (c.type === 'action') verdict_outil = c.outil && (proposes.includes(c.outil) || r.lectures.includes(c.outil)) && !interdit ? 'exact' : (c.voisins ?? []).some((v) => r.lectures.includes(v)) && proposes.length === 0 ? 'partiel' : 'rate';
  else verdict_outil = c.outil && r.lectures.includes(c.outil) ? 'exact' : (c.voisins ?? []).some((v) => r.lectures.includes(v)) ? 'partiel' : 'rate';

  const manquants: string[] = [];
  let verdict_params: Resultat['verdict_params'] = 'sans_objet';
  if (verdict_outil === 'exact' && c.type === 'action' && (c.params || c.cible)) {
    for (const [k, v] of Object.entries(c.params ?? {})) if (!paramTrouve(r.args, k, v)) manquants.push(`${k}=${v}`);
    const carte = plat(JSON.stringify(r.apercu ?? ''));
    for (const t of c.cible ?? []) if (!carte.includes(plat(t))) manquants.push(`carte:${t}`);
    verdict_params = manquants.length ? 'faux' : 'exact';
  }
  // Rien n'est exécuté en mode « demander » (hors mémoire de Lumi) : tout « c'est fait » est faux.
  const faux_fait = c.type !== 'lecture' && r.executes === 0 && !(c.outil && r.lectures.includes(c.outil)) && pretendFait(r.reponse);
  return { verdict_outil, verdict_params, faux_fait, interdit_propose: interdit, params_manquants: manquants };
}

/**
 * --prod : la batterie tourne contre la VRAIE API, dans une org de TEST de la prod.
 * Garde-fous : org nommée par --org et dont le nom dit « QA », « TEST » ou « banc » ;
 * aucun changement de forfait ni de budget (ils touchent tous les clients du forfait) ;
 * un cas à la fois (la prod limite à 60 tours par heure et par personne) ; seule
 * écriture du runner : memberships.lumi_mode du compte de test, remis à la fin.
 */
const PROD = process.argv.includes('--prod');
const FICHIER_ETAT = join(ICI, 'resultats', PROD ? '.etat-prod.json' : '.etat-staging.json');

async function connexion(): Promise<{ url: string; service: string; anon: string }> {
  if (!PROD) {
    const url = process.env.VITE_SUPABASE_URL ?? '';
    if (process.env.SUPABASE_PROJECT_REF_PROD && url.includes(process.env.SUPABASE_PROJECT_REF_PROD)) throw new Error('Refus : la prod (ajouter --prod pour une org de test de la prod).');
    return { url, service: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '', anon: process.env.VITE_SUPABASE_ANON_KEY ?? '' };
  }
  const ref = process.env.SUPABASE_PROJECT_REF_PROD ?? '';
  const url = process.env.SUPABASE_URL_PROD ?? '';
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY_PROD ?? '';
  if (!ref || !url || !service) throw new Error('--prod : SUPABASE_PROJECT_REF_PROD, SUPABASE_URL_PROD et SUPABASE_SERVICE_ROLE_KEY_PROD requis (.env.local).');
  // La clé publique de la prod n'est pas dans .env.local (qui pointe sur staging) : on la lit à la source.
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys`, { headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN ?? ''}` } });
  if (!r.ok) throw new Error(`--prod : clé publique illisible (${r.status})`);
  const cles = (await r.json()) as Array<{ name: string; api_key: string }>;
  const anon = cles.find((c) => c.name === 'anon')?.api_key ?? '';
  if (!anon) throw new Error('--prod : clé publique introuvable');
  return { url, service, anon };
}

/** Remet le mode Lumi, le budget du forfait et le forfait de l'org QA (staging). */
async function remettreEtat(admin: any, etat: { orgId: string; userId: string; lumi_mode: string | null; budget: { planId: string; valeurs: Record<string, number> } | null; forfait: { id: string; plan_id: string } | null }) {
  await admin.from('memberships').update({ lumi_mode: etat.lumi_mode ?? 'argent' }).eq('user_id', etat.userId).eq('org_id', etat.orgId);
  if (etat.budget) { await admin.from('plans').update(etat.budget.valeurs).eq('id', etat.budget.planId); console.log('budget d’origine remis'); }
  if (etat.forfait) { await admin.from('subscriptions').update({ plan_id: etat.forfait.plan_id }).eq('id', etat.forfait.id); console.log('forfait d’origine remis'); }
  try { writeFileSync(FICHIER_ETAT, ''); } catch { /* rien à effacer */ }
}

async function main() {
  // --remettre : rejoue la remise en état d'une batterie interrompue, puis s'arrête.
  if (process.argv.includes('--remettre')) {
    const c0 = await connexion();
    const brut = (() => { try { return readFileSync(FICHIER_ETAT, 'utf8'); } catch { return ''; } })();
    if (!brut.trim()) { console.log('rien à remettre'); process.exit(0); }
    await remettreEtat(createClient(c0.url, c0.service, { auth: { persistSession: false, autoRefreshToken: false } }), JSON.parse(brut));
    console.log('mode Lumi d’origine remis');
    process.exit(0);
  }
  const API = arg('--api', PROD ? 'https://lumecrm.net' : process.env.QA_API_URL || 'http://localhost:3012').replace(/\/$/, '');
  const SECTION = arg('--section', '');
  const SEULEMENT = arg('--seulement', '') ? new Set(arg('--seulement', '').split(',')) : null;
  const SORTIE = arg('--sortie', join(ICI, 'resultats', `run-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`));
  const PARALLELE = PROD ? 1 : Math.max(1, Math.min(5, Number(arg('--parallele', '3')) || 3));
  const COMPTE = arg('--compte', process.env.QA_COMPTE || (PROD ? '' : 'willhebert30@gmail.com'));
  const ORG = arg('--org', '');
  const DOSSIER_CAS = arg('--cas', PROD ? join(ICI, 'cas-prod') : join(ICI, 'cas'));
  if (PROD && (!ORG || !COMPTE)) throw new Error('--prod exige --org <id de l’org de test> et --compte <courriel du compte de test>.');
  if (PROD && (arg('--forfait', '') || arg('--budget', ''))) throw new Error('--prod : --forfait et --budget sont refusés (ils changent le forfait de vrais clients).');
  const cx = await connexion();
  const admin = createClient(cx.url, cx.service, { auth: { persistSession: false, autoRefreshToken: false } });
  const anon = createClient(cx.url, cx.anon, { auth: { persistSession: false, autoRefreshToken: false } });
  if (PROD) {
    const { data: o } = await admin.from('orgs').select('name').eq('id', ORG).maybeSingle();
    const nom = String((o as any)?.name ?? '');
    if (!/\b(QA|TEST|banc)\b/i.test(nom)) throw new Error(`--prod : « ${nom || ORG} » n’a pas un nom d’org de test (QA, TEST, banc) — refus.`);
    console.log(`PROD — org de test « ${nom} », compte ${COMPTE}, API ${API}`);
  }

  // --reprendre fichier.json : rejoue seulement les cas en ERREUR (serveur tombé, réseau) et fusionne.
  const REPRENDRE = arg('--reprendre', '');
  const precedents: Resultat[] = REPRENDRE ? JSON.parse(readFileSync(REPRENDRE, 'utf8')).resultats : [];
  const aRejouer = new Set(precedents.filter((r) => r.verdict_outil === 'erreur').map((r) => r.id));
  const tous = chargerCas(DOSSIER_CAS).filter((c) => (!SECTION || c.section === SECTION) && (!SEULEMENT || SEULEMENT.has(c.outil ?? c.id))
    && (!REPRENDRE || aRejouer.has(c.id) || !precedents.some((r) => r.id === c.id)));
  const { data: l, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: COMPTE });
  if (error) throw new Error(`lien magique : ${error.message}`);
  const { data: s, error: e2 } = await anon.auth.verifyOtp({ token_hash: l.properties.hashed_token, type: 'magiclink' });
  if (e2 || !s.session) throw new Error(`session : ${e2?.message}`);
  const userId = s.session.user.id;
  let qm = admin.from('memberships').select('org_id, lumi_mode').eq('user_id', userId).eq('status', 'active');
  if (ORG) qm = qm.eq('org_id', ORG);
  const { data: m } = await qm.limit(1).maybeSingle();
  if (!m) throw new Error(ORG ? `le compte ${COMPTE} n’est pas membre actif de l’org ${ORG}` : 'aucune org');
  const orgId = (m as any).org_id as string;
  let jeton = s.session.access_token;
  let rafraichir = s.session.refresh_token;

  async function demander(c: Cas): Promise<Resultat> {
    const debut = Date.now();
    const r = { proposition: null as string | null, groupe: [] as string[], lectures: [] as string[], executes: 0, args: null as Record<string, unknown> | null, apercu: null as unknown, reponse: '', cout_cents: 0, erreur: undefined as string | undefined, conversation_id: null as string | null };
    for (let essai = 0; essai < 8; essai++) {
      try {
        const res = await fetch(`${API}/api/lumi/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jeton}`, 'x-org-id': orgId, Connection: 'close' },
          body: JSON.stringify({ conversation_id: null, message: c.q, language: c.langue }),
        });
        const brut = await res.text();
        if (res.status === 429 && essai < 7) {
          // Limiteur par minute de la route : on attend le délai annoncé, on ne compte pas un échec.
          const s = Number(res.headers.get('retry-after') ?? /(\d+)\s*seconde/.exec(brut)?.[1] ?? 20);
          if (s > 90) console.log(`limite horaire atteinte : attente de ${Math.ceil(s / 60)} min`);
          await new Promise((ok) => setTimeout(ok, (s + 2) * 1000));
          continue;
        }
        if (res.status === 401 && essai < 7) {
          const { data: n } = await anon.auth.refreshSession({ refresh_token: rafraichir });
          if (n.session) { jeton = n.session.access_token; rafraichir = n.session.refresh_token; }
          continue;
        }
        if (!res.ok) { r.erreur = `${res.status} ${brut.slice(0, 160)}`; break; }
        for (const ev of brut.split('\n\n')) {
          const t = /event: (\w+)/.exec(ev)?.[1]; const d = /data: (.*)/.exec(ev)?.[1]; if (!t || !d) continue;
          let j: any; try { j = JSON.parse(d); } catch { continue; }
          if (t === 'text') r.reponse += j.delta ?? '';
          else if (t === 'tool' && j.statut === 'debut') r.lectures.push(j.name);
          else if (t === 'executed') r.executes += 1;
          else if (t === 'proposal' && j.auto) {
            // Écriture exécutée d'office (mémoire de Lumi) : l'outil choisi compte comme proposé.
            r.groupe.push(j.tool);
            if (!r.args) { r.args = j.args ?? null; r.apercu = j.apercu ?? null; }
          } else if (t === 'proposal') {
            r.proposition = j.tool; r.args = j.args ?? null; r.apercu = j.apercu ?? null;
            r.groupe = [...r.groupe, ...(j.groupe ?? []).map((g: any) => g.tool).filter((x: string) => x !== j.tool)];
            if (j.groupe) r.apercu = j.groupe.map((g: any) => g.apercu);
          } else if (t === 'done') { r.cout_cents = j.cost_cents ?? 0; r.conversation_id = j.conversation_id ?? null; }
          else if (t === 'error') r.erreur = j.message;
        }
        r.erreur = r.erreur && r.erreur !== 'trop_d_etapes' ? r.erreur : undefined;
        break;
      } catch (e: any) {
        if (essai >= 2) { r.erreur = `réseau : ${e?.message || e}`; break; }
      }
    }
    const v = juger(c, r);
    return { id: c.id, section: c.section, outil: c.outil, type: c.type, langue: c.langue, sensible: Boolean(c.sensible), q: c.q, ...v, ...r, duree_ms: Date.now() - debut };
  }

  // Forfait temporaire (staging seulement, --forfait autopilot) : l'org QA peut être
  // sur un forfait sans Lumi. On le change le temps de la batterie, puis on le remet.
  const FORFAIT = arg('--forfait', '');
  let forfaitAvant: { id: string; plan_id: string } | null = null;
  if (FORFAIT) {
    const { data: abo } = await admin.from('subscriptions').select('id, plan_id').eq('org_id', orgId).eq('status', 'active').limit(1).maybeSingle();
    const { data: plan } = await admin.from('plans').select('id').eq('slug', FORFAIT).maybeSingle();
    if (!abo || !plan) throw new Error(`forfait temporaire impossible (abonnement ou forfait ${FORFAIT} introuvable)`);
    forfaitAvant = abo as any;
    await admin.from('subscriptions').update({ plan_id: (plan as any).id }).eq('id', (abo as any).id);
    console.log(`forfait temporaire : ${FORFAIT} (sera remis à la fin)`);
  }
  // --budget 100000 (cents, staging) : le budget mensuel du forfait de l'org est relevé le
  // temps de la batterie, puis remis. Sans ça, la batterie épuise le mois ou déclenche le
  // plafond journalier (palier « restreint ») en cours de route, et la comparaison est faussée.
  const BUDGET = Number(arg('--budget', '0')) || 0;
  let budgetAvant: { planId: string; valeurs: Record<string, number> } | null = null;
  if (BUDGET > 0) {
    const { data: abo } = await admin.from('subscriptions').select('plan_id').eq('org_id', orgId).eq('status', 'active').limit(1).maybeSingle();
    const { data: plan } = await admin.from('plans').select('*').eq('id', (abo as any)?.plan_id).maybeSingle();
    if (!plan) throw new Error('budget temporaire impossible (forfait introuvable)');
    // Deux modèles de plafond selon la migration « crédits Lumi » (2026-10-05) :
    // cents (ai_monthly_budget_cents) ou crédits (lumi_credits_mensuels, 1 crédit = 3 ¢).
    const valeurs: Record<string, number> = {};
    const nouvelles: Record<string, number> = {};
    if ('ai_monthly_budget_cents' in (plan as any)) { valeurs.ai_monthly_budget_cents = Number((plan as any).ai_monthly_budget_cents) || 0; nouvelles.ai_monthly_budget_cents = BUDGET; }
    if ('lumi_credits_mensuels' in (plan as any)) { valeurs.lumi_credits_mensuels = Number((plan as any).lumi_credits_mensuels) || 0; nouvelles.lumi_credits_mensuels = Math.ceil(BUDGET / 3); }
    budgetAvant = { planId: (plan as any).id, valeurs };
    await admin.from('plans').update(nouvelles).eq('id', budgetAvant.planId);
    console.log(`budget temporaire : ${JSON.stringify(nouvelles)} (sera remis à ${JSON.stringify(valeurs)})`);
  }
  // Mode « demander » le temps de la batterie : aucune écriture ne s'exécute.
  // État d'origine écrit sur disque AVANT toute modification : si la batterie est tuée
  // (le « finally » ne tourne pas), `--remettre` le rejoue. Vécu le 2026-10-01 :
  // batterie arrêtée, org QA restée sur autopilot avec un budget relevé.
  const etat = { orgId, userId, lumi_mode: (m as any).lumi_mode as string | null, budget: budgetAvant, forfait: forfaitAvant };
  writeFileSync(FICHIER_ETAT, JSON.stringify(etat, null, 1));
  let remis = false;
  const remettre = async () => {
    if (remis) return;
    remis = true;
    await remettreEtat(admin, etat);
  };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK'] as const) process.once(sig, () => { void remettre().finally(() => process.exit(130)); });
  await admin.from('memberships').update({ lumi_mode: 'demander' }).eq('user_id', userId).eq('org_id', orgId);
  // Le serveur garde la session (forfait, budget, mode) 30 s en cache : sans cette attente,
  // les premiers cas tombent sur l'ancien forfait (« Lumi is not included in this plan »).
  if (FORFAIT || BUDGET > 0 || PROD) { console.log('attente de 35 s (cache de session du serveur)'); await new Promise((ok) => setTimeout(ok, 35_000)); }
  const resultats: Resultat[] = [];
  // Sauvegarde au fil de l'eau : une batterie tuée (session fermée, 175 cas perdus le
  // 2026-10-01) se reprend avec `--reprendre <sortie>.partiel` au lieu de tout rejouer.
  const PARTIEL = SORTIE + '.partiel';
  mkdirSync(dirname(SORTIE), { recursive: true });
  const fusion = () => { const nouveaux = new Set(resultats.map((r) => r.id)); return [...precedents.filter((r) => !nouveaux.has(r.id)), ...resultats]; };
  try {
    const file = [...tous];
    await Promise.all(Array.from({ length: PARALLELE }, async () => {
      while (file.length) {
        const c = file.shift()!;
        const r = await demander(c);
        resultats.push(r);
        if (resultats.length % 5 === 0) { writeFileSync(PARTIEL + '.tmp', JSON.stringify({ date: new Date().toISOString(), api: API, partiel: true, resultats: fusion() })); renameSync(PARTIEL + '.tmp', PARTIEL); }
        const ico = r.verdict_outil === 'exact' ? (r.verdict_params === 'faux' ? 'PARAM' : 'OK   ') : r.verdict_outil === 'partiel' ? 'PART ' : r.verdict_outil === 'erreur' ? 'ERR  ' : 'RATE ';
        console.log(`${ico}${r.faux_fait ? ' FAUX-FAIT' : ''} ${c.id.padEnd(34)} ${(r.proposition ? 'propose ' + r.proposition : r.lectures.length ? 'lit ' + r.lectures.join(',') : 'rien').slice(0, 60).padEnd(60)} ${r.cout_cents.toFixed(2)} ¢${r.params_manquants.length ? ' manque ' + r.params_manquants.join(',') : ''}${r.erreur ? ' ' + r.erreur : ''}`);
      }
    }));
  } finally {
    await remettre();
  }
  // Coût réel : l'événement « done » ne porte plus cost_cents depuis les crédits Lumi
  // (il porte « credits ») — on somme ai_usage par conversation, routeur compris.
  await new Promise((ok) => setTimeout(ok, 3000));
  if (REPRENDRE) { const tout = fusion(); resultats.length = 0; resultats.push(...tout); }
  const ids = resultats.filter((r) => !r.cout_cents).map((r) => r.conversation_id).filter((x): x is string => Boolean(x));
  const cout = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data: lignes } = await admin.from('ai_usage').select('conversation_id, cost_cents').in('conversation_id', ids.slice(i, i + 100));
    for (const l of (lignes ?? []) as Array<{ conversation_id: string; cost_cents: number | string }>) cout.set(l.conversation_id, (cout.get(l.conversation_id) ?? 0) + Number(l.cost_cents ?? 0));
  }
  for (const r of resultats) if (!r.cout_cents && r.conversation_id) r.cout_cents = Math.round((cout.get(r.conversation_id) ?? 0) * 10000) / 10000;

  const bilan = bilanDe(resultats);
  writeFileSync(SORTIE, JSON.stringify({ date: new Date().toISOString(), api: API, bilan, resultats }, null, 1));
  console.log('\n' + texteBilan(bilan));
  process.exit(0);
}

export function bilanDe(resultats: Resultat[]) {
  const calc = (rs: Resultat[]) => {
    const n = rs.length || 1;
    const avecOutil = rs.filter((r) => r.type !== 'clarification');
    const clar = rs.filter((r) => r.type === 'clarification');
    const avecParams = rs.filter((r) => r.verdict_params !== 'sans_objet');
    return {
      cas: rs.length,
      exactitude_outil_pct: Math.round((avecOutil.filter((r) => r.verdict_outil === 'exact').length / (avecOutil.length || 1)) * 1000) / 10,
      partiels: rs.filter((r) => r.verdict_outil === 'partiel').length,
      rates: rs.filter((r) => r.verdict_outil === 'rate').length,
      erreurs: rs.filter((r) => r.verdict_outil === 'erreur').length,
      exactitude_params_pct: avecParams.length ? Math.round((avecParams.filter((r) => r.verdict_params === 'exact').length / avecParams.length) * 1000) / 10 : null,
      clarification_pct: clar.length ? Math.round((clar.filter((r) => r.verdict_outil === 'exact').length / clar.length) * 1000) / 10 : null,
      faux_fait: rs.filter((r) => r.faux_fait).length,
      interdits_proposes: rs.filter((r) => r.interdit_propose).length,
      cout_cents: Math.round(rs.reduce((t, r) => t + r.cout_cents, 0) * 100) / 100,
      cout_par_1000_dollars: Math.round((rs.reduce((t, r) => t + r.cout_cents, 0) / n) * 1000) / 100,
    };
  };
  const sections = [...new Set(resultats.map((r) => r.section))].sort();
  return {
    global: calc(resultats),
    sensibles: calc(resultats.filter((r) => r.sensible)),
    par_type: Object.fromEntries(['action', 'lecture', 'clarification'].map((t) => [t, calc(resultats.filter((r) => r.type === t))])),
    par_section: Object.fromEntries(sections.map((s) => [s, calc(resultats.filter((r) => r.section === s))])),
  };
}

export function texteBilan(b: ReturnType<typeof bilanDe>): string {
  const ligne = (nom: string, x: ReturnType<typeof bilanDe>['global']) =>
    `${nom.padEnd(16)} ${String(x.cas).padStart(4)} cas · outil ${String(x.exactitude_outil_pct).padStart(5)} % · params ${x.exactitude_params_pct ?? '—'} % · clarif ${x.clarification_pct ?? '—'} % · faux fait ${x.faux_fait} · ${(x.cout_cents / 100).toFixed(2)} $ (${x.cout_par_1000_dollars} $/1000)`;
  return [ligne('GLOBAL', b.global), ligne('sensibles', b.sensibles), ...Object.entries(b.par_type).map(([k, v]) => ligne(k, v)), '', ...Object.entries(b.par_section).map(([k, v]) => ligne(k, v))].join('\n');
}

if (process.argv[1] && /run\.mts$/.test(process.argv[1])) main().catch((e) => { console.error(e); process.exit(1); });
