/* ═══════════════════════════════════════════════════════════════
   Agent F — outils communs des mesures de coût de Lumi (automatisations).

   Tout passe par l'API LOCALE (pile locale `lumefinal-*`), avec une vraie
   session du compte de test du jeu de bureaux « f ». Rien ne vise la prod ni
   staging : le module refuse de se charger si l'adresse Supabase n'est pas
   locale.

   Ce qu'il fournit :
   - `preparer()`       : bureaux de test, session du propriétaire A, API ;
   - `clavarder()`      : POST /api/lumi/chat (flux SSE), avec la latence, le
                          premier texte, les outils, la carte et l'usage brut
                          de chaque appel au modèle (événement `usage`) ;
   - `deciderCarte()`   : POST /api/lumi/execute (bouton Confirmer / Annuler) ;
   - `genererPanneau()` : POST /api/automations/rules/generer (« Construire
                          avec Lumi » de l'éditeur) ;
   - `releve()`         : ce que la base a écrit pendant un appel — lignes
                          `ai_usage` (grand livre) et `lumi_traces` ;
   - `parcoursDe(n)`    : un parcours valide de n étapes, pour mesurer des
                          tailles.
   ═══════════════════════════════════════════════════════════════ */
import type { SupabaseClient } from '@supabase/supabase-js';
import { assurerBureauTest, sessionDe, COMPTES, adminStaging, type BureauTest } from '../../../../tests/automations-suite/harnais/bureau-test';
import { coutEnCents, TARIFS } from '../../../../server/lib/lumi/tarifs';

export const API = process.env.F_API || 'http://127.0.0.1:3496';
export const SORTIES = 'D:/lume-final/sorties';

export function exigerPileLocale(): void {
  const url = process.env.VITE_SUPABASE_URL ?? '';
  if (!/localhost|127\.0\.0\.1/.test(url)) {
    throw new Error(`REFUS : ces mesures ne tournent que sur la pile locale (VITE_SUPABASE_URL = ${url || 'vide'}).`);
  }
  if ((process.env.QA_AUTO_SUFFIXE || '') !== 'f') {
    throw new Error('REFUS : lancer avec QA_AUTO_SUFFIXE=f (bureaux de test de l’agent F).');
  }
}

export interface Atelier {
  admin: SupabaseClient;
  bureau: BureauTest;
  orgA: string;
  orgB: string;
  jetonA: string;
  jetonB: string;
}

export async function preparer(): Promise<Atelier> {
  exigerPileLocale();
  const admin = adminStaging();
  const bureau = await assurerBureauTest(admin);
  const a = await sessionDe(admin, COMPTES.proprioA.email);
  const b = await sessionDe(admin, COMPTES.proprioB.email);
  const sante = await fetch(`${API}/api/health`).then((r) => r.ok).catch(() => false);
  if (!sante) throw new Error(`API locale injoignable sur ${API} (node D:/lume-final/outils/serveurs.mjs D:/lume-final/wt-f 3496 5496 --lumi).`);
  return { admin, bureau, orgA: bureau.orgA, orgB: bureau.orgB, jetonA: a.jeton, jetonB: b.jeton };
}

export interface Session { jeton: string; orgId: string }
const entetes = (s: Session) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${s.jeton}`, 'x-org-id': s.orgId });

/* ── Usage brut d'un appel au modèle (événement SSE `usage`) ── */
export interface UsageBrut {
  input_tokens: number; output_tokens: number;
  cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null;
  cache_creation?: { ephemeral_1h_input_tokens: number; ephemeral_5m_input_tokens: number } | null;
}

export interface ReponseClavardage {
  statut: number;
  texte: string;
  outils: string[];
  proposition: { tool_use_id: string; tool: string; args: Record<string, unknown>; groupe?: Array<{ tool_use_id: string; tool: string }> } | null;
  executes: Array<{ tool_use_id: string; ok: boolean; auto?: boolean }>;
  conversation_id: string | null;
  etage: number | null;
  credits: Record<string, unknown> | null;
  appels: Array<{ model: string; usage: UsageBrut }>;
  erreur: unknown;
  /** Durée totale vue du client, et délai du premier texte. */
  latence_ms: number;
  premier_texte_ms: number | null;
  /** Tout ce que le flux a porté, tel quel : sert à chercher un montant en dollars. */
  brut: string;
}

async function lireSse(res: Response, debut: number): Promise<ReponseClavardage> {
  const r: ReponseClavardage = {
    statut: res.status, texte: '', outils: [], proposition: null, executes: [], conversation_id: null, etage: null,
    credits: null, appels: [], erreur: null, latence_ms: 0, premier_texte_ms: null, brut: '',
  };
  if (!res.ok || !res.body) {
    const corps = await res.text();
    r.brut = corps;
    try { r.erreur = JSON.parse(corps); } catch { r.erreur = corps; }
    r.latence_ms = Date.now() - debut;
    return r;
  }
  const lecteur = res.body.getReader();
  const decodeur = new TextDecoder();
  let tampon = '';
  const traiter = (bloc: string) => {
    const type = /event: (\w+)/.exec(bloc)?.[1];
    const donnees = /data: (.*)/s.exec(bloc)?.[1];
    if (!type || !donnees) return;
    let j: Record<string, any>;
    try { j = JSON.parse(donnees); } catch { return; }
    if (type === 'text') {
      if (r.premier_texte_ms === null) r.premier_texte_ms = Date.now() - debut;
      r.texte += String(j.delta ?? '');
    } else if (type === 'tool' && j.statut === 'debut') r.outils.push(String(j.name));
    else if (type === 'proposal' && !j.auto) r.proposition = { tool_use_id: j.tool_use_id, tool: j.tool, args: j.args ?? {}, groupe: j.groupe };
    else if (type === 'executed') r.executes.push({ tool_use_id: j.tool_use_id, ok: !!j.ok, auto: !!j.auto });
    else if (type === 'usage') r.appels.push({ model: String(j.model), usage: j.usage as UsageBrut });
    else if (type === 'error') r.erreur = j;
    else if (type === 'done') {
      r.conversation_id = j.conversation_id ?? null;
      r.etage = typeof j.etage === 'number' ? j.etage : null;
      r.credits = j.credits ?? null;
      if (j.proposal && !r.proposition) r.proposition = j.proposal;
    }
  };
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    const morceau = decodeur.decode(value, { stream: true });
    r.brut += morceau;
    tampon += morceau;
    let i: number;
    while ((i = tampon.indexOf('\n\n')) !== -1) {
      traiter(tampon.slice(0, i));
      tampon = tampon.slice(i + 2);
    }
  }
  if (tampon.trim()) traiter(tampon);
  r.latence_ms = Date.now() - debut;
  return r;
}

export async function clavarder(s: Session, message: string, conversationId: string | null = null): Promise<ReponseClavardage> {
  const debut = Date.now();
  const res = await fetch(`${API}/api/lumi/chat`, { method: 'POST', headers: entetes(s), body: JSON.stringify({ message, conversation_id: conversationId, language: 'fr' }) });
  return lireSse(res, debut);
}

export async function deciderCarte(s: Session, conversationId: string, toolUseId: string, decision: 'confirm' | 'cancel' = 'confirm'): Promise<ReponseClavardage> {
  const debut = Date.now();
  const res = await fetch(`${API}/api/lumi/execute`, { method: 'POST', headers: entetes(s), body: JSON.stringify({ conversation_id: conversationId, tool_use_id: toolUseId, decision, language: 'fr' }) });
  return lireSse(res, debut);
}

export interface Echange { role: 'user' | 'assistant'; content: string }
export interface ParcoursEcran { trigger_event?: string; steps?: unknown[] }
export interface ReponsePanneau {
  statut: number;
  corps: Record<string, any> | null;
  brut: string;
  latence_ms: number;
}

export async function genererPanneau(s: Session, demande: string, contexte: { echanges?: Echange[]; parcoursActuel?: ParcoursEcran | null; ruleId?: string | null } = {}): Promise<ReponsePanneau> {
  const debut = Date.now();
  const res = await fetch(`${API}/api/automations/rules/generer`, {
    method: 'POST', headers: entetes(s),
    body: JSON.stringify({ demande, langue: 'fr', echanges: contexte.echanges, parcours_actuel: contexte.parcoursActuel ?? null, rule_id: contexte.ruleId ?? null }),
  });
  const brut = await res.text();
  let corps: Record<string, any> | null = null;
  try { corps = JSON.parse(brut); } catch { corps = null; }
  return { statut: res.status, corps, brut, latence_ms: Date.now() - debut };
}

export async function creditsVus(s: Session): Promise<Record<string, any>> {
  const res = await fetch(`${API}/api/lumi/credits`, { headers: entetes(s) });
  return res.json();
}

/* ── Ce que la base a écrit pendant un appel ── */
export interface LigneUsage {
  id: string; model: string; source: string | null; conversation_id: string | null; request_id: string | null;
  input_tokens: number; output_tokens: number; cache_creation_input_tokens: number; cache_read_input_tokens: number;
  cost_cents: number; credits_micro: number | null; created_at: string;
}
export interface LigneTrace {
  id: string; conversation_id: string | null; canal: string; origine: string; etage: number | null; action: string | null;
  params: Record<string, any> | null; outils: string[]; resultat: string; model: string | null;
  input_tokens: number; cache_5m: number; cache_1h: number; cache_lu: number; output_tokens: number;
  cost_cents: number | null; duree_ms: number | null; created_at: string;
}

/** Repère : la dernière ligne déjà écrite, pour ne lire ensuite que les nouvelles. */
export async function repere(admin: SupabaseClient, orgId: string): Promise<{ usage: string; trace: string }> {
  const dernier = async (table: string) => {
    const { data } = await admin.from(table).select('created_at').eq('org_id', orgId).order('created_at', { ascending: false }).limit(1).maybeSingle();
    return String((data as { created_at?: string } | null)?.created_at ?? '1970-01-01T00:00:00Z');
  };
  return { usage: await dernier('ai_usage'), trace: await dernier('lumi_traces') };
}

/**
 * Lignes écrites depuis le repère. Les traces partent sans attendre la réponse
 * (`void journaliserTrace`) : on relit jusqu'à ce que le compte ne bouge plus.
 */
export async function releve(admin: SupabaseClient, orgId: string, depuis: { usage: string; trace: string }, attendreTrace = true): Promise<{ usage: LigneUsage[]; traces: LigneTrace[] }> {
  const lire = async () => {
    const [{ data: u, error: eu }, { data: t, error: et }] = await Promise.all([
      admin.from('ai_usage').select('*').eq('org_id', orgId).gt('created_at', depuis.usage).order('created_at', { ascending: true }),
      admin.from('lumi_traces').select('*').eq('org_id', orgId).gt('created_at', depuis.trace).order('created_at', { ascending: true }),
    ]);
    if (eu) throw new Error(`ai_usage : ${eu.message}`);
    if (et) throw new Error(`lumi_traces : ${et.message}`);
    return { usage: (u ?? []) as LigneUsage[], traces: (t ?? []) as LigneTrace[] };
  };
  let avant = await lire();
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 400));
    const apres = await lire();
    const stable = apres.usage.length === avant.usage.length && apres.traces.length === avant.traces.length;
    avant = apres;
    if (stable && (!attendreTrace || apres.traces.length > 0 || i >= 4)) break;
  }
  return avant;
}

/* ── Calculs ── */
export const n = (v: unknown): number => Number(v ?? 0) || 0;

/** Coût recalculé à partir des tokens d'une ligne du grand livre (écriture de cache comptée 5 min, puis 1 h). */
export function coutRecalcule(l: LigneUsage): { cinqMin: number; uneHeure: number } {
  const base = { input_tokens: n(l.input_tokens), output_tokens: n(l.output_tokens), cache_read_input_tokens: n(l.cache_read_input_tokens) };
  const ecrit = n(l.cache_creation_input_tokens);
  return {
    cinqMin: coutEnCents(l.model, { ...base, cache_creation_input_tokens: ecrit, cache_creation: { ephemeral_5m_input_tokens: ecrit, ephemeral_1h_input_tokens: 0 } }),
    uneHeure: coutEnCents(l.model, { ...base, cache_creation_input_tokens: ecrit, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: ecrit } }),
  };
}

export interface Mesure {
  id: string;
  chemin: 'clavardage' | 'panneau';
  demande: string;
  /** Ce que la personne a lu (début). */
  reponse: string;
  modeles: string[];
  appels_modele: number;
  outils_charges: number | null;
  outils_appeles: string[];
  carte: string | null;
  etage: number | null;
  entree: number; cache_lu: number; cache_ecrit: number; cache_ecrit_5m: number | null; cache_ecrit_1h: number | null; sortie: number;
  taux_cache: number | null;
  cout_cents: number;
  cout_recalcule_cents: number;
  credits_micro: number;
  credits: number;
  ecart_debit_micro: number;
  latence_ms: number;
  premier_texte_ms: number | null;
  lignes_usage: number;
  lignes_trace: number;
  trace_cout_cents: number | null;
  sources: string[];
  notes: string[];
}

/** Assemble une mesure à partir de ce que la base a écrit pendant un ou plusieurs appels. */
export function assembler(p: {
  id: string; chemin: Mesure['chemin']; demande: string; reponse: string; latence_ms: number; premier_texte_ms?: number | null;
  usage: LigneUsage[]; traces: LigneTrace[]; carte?: string | null; outilsVus?: string[]; etage?: number | null; notes?: string[];
}): Mesure {
  const somme = (f: (l: LigneUsage) => number) => p.usage.reduce((s, l) => s + f(l), 0);
  const entree = somme((l) => n(l.input_tokens));
  const lu = somme((l) => n(l.cache_read_input_tokens));
  const ecrit = somme((l) => n(l.cache_creation_input_tokens));
  const sortie = somme((l) => n(l.output_tokens));
  const cout = somme((l) => n(l.cost_cents));
  const micro = somme((l) => n(l.credits_micro));
  const tracesAgent = p.traces.filter((t) => t.etage === 6 || t.model);
  const e5 = p.traces.length ? p.traces.reduce((s, t) => s + n(t.cache_5m), 0) : null;
  const e1 = p.traces.length ? p.traces.reduce((s, t) => s + n(t.cache_1h), 0) : null;
  const mesures = p.traces.map((t) => t.params?.mesure).filter(Boolean) as Array<{ outils_charges?: number; appels_modele?: number }>;
  const outils = new Set<string>([...(p.outilsVus ?? []), ...p.traces.flatMap((t) => t.outils ?? [])]);
  const totalEntree = entree + lu + ecrit;
  return {
    id: p.id, chemin: p.chemin, demande: p.demande, reponse: p.reponse.replace(/\s+/g, ' ').slice(0, 400),
    modeles: [...new Set(p.usage.map((l) => l.model))],
    appels_modele: p.usage.length,
    outils_charges: mesures.length ? Math.max(...mesures.map((m) => n(m.outils_charges))) : null,
    outils_appeles: [...outils],
    carte: p.carte ?? null,
    etage: p.etage ?? (p.traces.length ? p.traces[p.traces.length - 1].etage : null),
    entree, cache_lu: lu, cache_ecrit: ecrit, cache_ecrit_5m: e5, cache_ecrit_1h: e1, sortie,
    taux_cache: totalEntree > 0 ? Math.round((lu / totalEntree) * 1000) / 10 : null,
    cout_cents: Math.round(cout * 10_000) / 10_000,
    cout_recalcule_cents: Math.round(p.usage.reduce((s, l) => s + coutRecalcule(l).cinqMin, 0) * 10_000) / 10_000,
    credits_micro: micro,
    credits: Math.round((micro / 1_000_000) * 1000) / 1000,
    ecart_debit_micro: Math.round(micro - (cout * 1_000_000) / 3),
    latence_ms: p.latence_ms, premier_texte_ms: p.premier_texte_ms ?? null,
    lignes_usage: p.usage.length, lignes_trace: p.traces.length,
    trace_cout_cents: tracesAgent.length ? Math.round(tracesAgent.reduce((s, t) => s + n(t.cost_cents), 0) * 10_000) / 10_000 : null,
    sources: [...new Set(p.usage.map((l) => String(l.source ?? 'lumi')))],
    notes: p.notes ?? [],
  };
}

export const TARIF = TARIFS;

/* ── Parcours synthétiques, valides pour `sequenceEtapes` ── */
export type Etape = Record<string, unknown>;

/**
 * Un parcours de `total` étapes, réaliste : un filtre, puis des cycles
 * « attendre → texto ou courriel », une condition tous les sept pas.
 * Les textes ont la longueur de ceux que Lumi écrit (≈ 150 caractères pour un
 * texto, ≈ 450 pour un courriel).
 */
export function parcoursDe(total: number): { trigger_event: string; steps: Etape[] } {
  const steps: Etape[] = [];
  const id = (i: number) => `e${i}`;
  for (let i = 1; i <= total; i++) {
    const suivant = i < total ? id(i + 1) : null;
    if (i === 1) {
      steps.push({ id: id(i), type: 'si', conditions: { montant: { gt: 500 } }, alors: suivant, sinon: null });
    } else if (i % 7 === 0 && i < total) {
      steps.push({ id: id(i), type: 'si', conditions: { status: { eq: 'sent' } }, alors: suivant, sinon: null });
    } else if (i % 2 === 0 && i < total) {
      steps.push({ id: id(i), type: 'attendre', delai_secondes: 86_400 * ((i % 5) + 1), suivant });
    } else if (i % 3 === 0) {
      steps.push({
        id: id(i), type: 'action', suivant,
        action: { type: 'send_email', config: {
          subject: `Votre soumission [quote_number] — suivi no ${i}`,
          body: `<p>Bonjour [client_first_name],</p><p>Nous voulions prendre de vos nouvelles au sujet de la soumission que nous vous avons envoyée. Elle est toujours disponible ici : [quote_link].</p><p>Si vous avez des questions sur les travaux, les délais ou le prix, répondez simplement à ce courriel : nous vous reviendrons rapidement.</p><p>Merci de votre confiance,<br/>[company_name]</p>`,
        } },
      });
    } else {
      steps.push({
        id: id(i), type: 'action', suivant,
        action: { type: 'send_sms', config: { body: `Bonjour [client_first_name], un petit suivi de votre soumission (rappel ${i}) : [quote_link]. Des questions ? Répondez à ce texto. [company_name]` } },
      });
    }
  }
  return { trigger_event: 'quote.sent', steps };
}

/** Tableau Markdown simple. */
export function tableau(entetes: string[], lignes: Array<Array<string | number | null>>): string {
  const cell = (v: string | number | null) => (v === null || v === undefined ? '—' : String(v).replace(/\|/g, '\\|'));
  return [`| ${entetes.join(' | ')} |`, `| ${entetes.map(() => '---').join(' | ')} |`, ...lignes.map((l) => `| ${l.map(cell).join(' | ')} |`)].join('\n');
}
