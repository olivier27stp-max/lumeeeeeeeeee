/**
 * Lumi sur mobile — client de /api/lumi/*.
 *
 * ZÉRO fork de l'agent : ce fichier est le jumeau de `src/lib/lumiApi.ts` du
 * web. Mêmes routes, mêmes types, même protocole. Toute la logique (prompt,
 * outils, RBAC, budget, historique) reste sur le serveur ; le mobile n'a
 * qu'un JWT Supabase et l'id du bureau actif.
 *
 * Le chat est un flux SSE sur une requête POST (EventSource ne fait que du
 * GET) : on lit le corps en continu et on découpe `event: x\ndata: {...}\n\n`.
 * L'interface ne renvoie JAMAIS l'historique : le serveur le garde et le
 * rejoue — c'est ce qui fait qu'une conversation commencée sur le web se
 * poursuit ici, et l'inverse.
 *
 * `fetch` de React Native ne sait pas streamer (il passe par XHR et ne remplit
 * `body` qu'à la fin) ; on utilise donc `expo/fetch`, qui expose un vrai
 * ReadableStream.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetch as fetchStream } from 'expo/fetch';

import type { EtatCredits, HistoriqueCredits } from '../lumi/credits';
import { ACTIVE_ORG_KEY } from '../membership';
import { supabase } from '../supabase';

const BASE = process.env.EXPO_PUBLIC_WEB_URL?.replace(/\/$/, '') ?? '';

/** Sans URL de serveur, Lumi ne peut pas fonctionner du tout. */
export function lumiConfigure(): boolean {
  return BASE.length > 0;
}

/** Jeton valide, rafraîchi s'il expire bientôt — même logique que api/server.ts. */
async function jetonFrais(forcer = false): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  let session = data.session;
  const expMs = (session?.expires_at ?? 0) * 1000;
  if (session && (forcer || expMs < Date.now() + 60_000)) {
    const { data: r } = await supabase.auth.refreshSession();
    if (r.session) session = r.session;
  }
  return session?.access_token ?? null;
}

async function entetes(jeton: string): Promise<Record<string, string>> {
  let org = '';
  try {
    org = (await AsyncStorage.getItem(ACTIVE_ORG_KEY)) ?? '';
  } catch {
    /* stockage indisponible : le serveur retombera sur la seule membership */
  }
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${jeton}`,
    ...(org ? { 'x-org-id': org } : {}),
  };
}

/* ────────────────────────────────────────────────────────────────────────
   Types — copiés à l'identique du web (src/lib/lumiApi.ts).
   ──────────────────────────────────────────────────────────────────────── */

/**
 * Quota de Lumi (contrat serveur du 2026-09-30, PR #817/#824) : l'usage se
 * compte en CRÉDITS, plus en dollars. L'ancien objet budget à plat
 * (`budget_cents`, `depense_cents`, `reste_cents`, `epuise`, `includes_ai`…)
 * n'existe plus : tout est dans `credits`, et `inclus` remplace `includes_ai`.
 */
export interface QuotaLumi {
  /** false = Lumi n'est pas activé sur ce serveur (clé API absente). */
  configured?: boolean;
  credits: EtatCredits;
}

export type { EtatCredits, HistoriqueCredits } from '../lumi/credits';

export type StatutProposition = 'en_attente' | 'confirmee' | 'annulee' | 'echouee';

/** Une fiche du CRM touchée par Lumi (client, job, devis…). */
export type TypeFiche = 'client' | 'lead' | 'job' | 'quote' | 'invoice' | 'task';
export interface FicheLumi {
  type: TypeFiche;
  id: string;
  label: string;
  href: string;
  montant_cents?: number;
}

/** Aperçu d'une écriture proposée, composé par le serveur (taxes de l'org incluses). */
export interface ApercuDocumentLumi {
  genre: 'quote' | 'invoice';
  client: { name: string; company: string | null; email: string | null; phone: string | null; address: string | null } | null;
  title: string;
  lignes: { name: string; description: string | null; quantity: number; unit_price_cents: number; total_cents: number }[];
  subtotal_cents: number;
  taxes: { label: string; rate: number; amount_cents: number }[];
  total_cents: number;
  valid_days: number | null;
  notes: string | null;
}
export interface ApercuMessageLumi {
  genre: 'sms' | 'email';
  to: string | null;
  subject: string | null;
  body: string;
}
export interface FicheClientApercuLumi {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  since: string | null;
  jobs: number;
  quotes: number;
  invoices: number;
}
export interface ApercuFusionLumi {
  genre: 'fusion';
  garder: FicheClientApercuLumi | null;
  absorber: FicheClientApercuLumi | null;
}
export type ApercuLumi = ApercuDocumentLumi | ApercuMessageLumi | ApercuFusionLumi;

export interface PropositionLumi {
  tool_use_id: string;
  tool: string;
  args: Record<string, unknown>;
  capacite: string | null;
  statut: StatutProposition;
  apercu?: ApercuLumi | null;
  /** Ce que l'action a créé (reçu) : « Devis Q-0043 », avec son lien. */
  fiche?: FicheLumi | null;
  /** Confirmée sans clic, parce que l'utilisateur a choisi « toujours confirmer ». */
  auto?: boolean;
  /** Plusieurs écritures d'un coup : une carte, une confirmation, un état par ligne. */
  groupe?: PropositionLumi[];
}

/** Rapport composé par le serveur (build_report) : déjà formaté. */
export interface SectionRapportLumi {
  titre: string;
  kpis?: { label: string; valeur: string; detail?: string }[];
  tableau?: { colonnes: string[]; lignes: string[][]; alignements?: ('g' | 'd')[] };
  note?: string;
}
export interface RapportLumi {
  type: 'financier' | 'retards' | 'jobs' | 'client';
  titre: string;
  sous_titre: string;
  periode: { du: string; au: string } | null;
  genere_le: string;
  langue: 'fr' | 'en';
  sections: SectionRapportLumi[];
}

/**
 * Tokens d'une réponse (somme des appels du tour), ou d'une conversation.
 * Plus de coût : depuis le 2026-09-30 le serveur ne renvoie plus `cost_cents`,
 * et aucun montant d'IA ne s'affiche au client.
 */
export interface UsageLumi {
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  appels: number;
}

export interface MessageLumi {
  role: 'user' | 'assistant';
  text: string;
  tools: string[];
  usage?: UsageLumi;
  proposal?: PropositionLumi;
  report?: RapportLumi;
  fiches?: FicheLumi[];
}

export interface ConversationLumi {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export type EvenementFlux =
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string; statut: 'debut' | 'fin' | 'refus' }
  | {
      type: 'proposal';
      tool_use_id: string;
      tool: string;
      args: Record<string, unknown>;
      capacite: string | null;
      apercu?: ApercuLumi | null;
      auto?: boolean;
      groupe?: { tool_use_id: string; tool: string; args: Record<string, unknown>; capacite: string | null; apercu?: ApercuLumi | null }[];
    }
  | { type: 'fiches'; fiches: FicheLumi[] }
  | { type: 'executed'; tool_use_id: string; ok: boolean; fiche: FicheLumi | null; auto?: boolean }
  | { type: 'report'; tool_use_id: string; rapport: RapportLumi }
  | { type: 'usage'; model: string; usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } }
  | { type: 'done'; conversation_id: string; credits: EtatCredits; proposal: { tool_use_id: string; tool: string; args: Record<string, unknown> } | null }
  | { type: 'error'; message: string };

export class ErreurLumi extends Error {
  code: string;
  /** 403 `plan_sans_lumi` : le serveur joint l'état des crédits (plus `budget`). */
  credits?: EtatCredits;
  constructor(code: string, message: string, credits?: EtatCredits) {
    super(message);
    this.name = 'ErreurLumi';
    this.code = code;
    this.credits = credits;
  }
}

/* ────────────────────────────────────────────────────────────────────────
   Le flux
   ──────────────────────────────────────────────────────────────────────── */

/** Un tour qui ne répond rien pendant deux minutes est considéré perdu. */
const TIMEOUT_MS = 120_000;

/**
 * Lit un flux SSE et appelle `onEvent` pour chaque événement.
 *
 * Exporté pour les tests : c'est le point d'entrée de TOUT le contrat SSE
 * (`done.credits`, `usage` sans coût, 403 `plan_sans_lumi`), donc l'endroit où
 * une rupture de contrat serveur doit se voir.
 */
export async function lireFlux(res: Response, onEvent: (e: EvenementFlux) => void, signal?: AbortSignal): Promise<void> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { code?: string; error?: string; credits?: EtatCredits };
    throw new ErreurLumi(body?.code || `http_${res.status}`, body?.error || `HTTP ${res.status}`, body?.credits);
  }
  const reader = res.body?.getReader();
  if (!reader) throw new ErreurLumi('flux', 'No stream');
  const decoder = new TextDecoder();
  let tampon = '';
  let recuQuelqueChose = false;
  for (;;) {
    if (signal?.aborted) {
      await reader.cancel().catch(() => {});
      return;
    }
    let value: Uint8Array | undefined;
    let done: boolean;
    try {
      ({ value, done } = await reader.read());
    } catch (e) {
      // Flux coupé en vol (réseau perdu, serveur redéployé). Ce qui est déjà
      // affiché reste ; l'appelant montre « Réessayer ».
      if (signal?.aborted) return;
      throw new ErreurLumi('flux_coupe', (e as Error)?.message ?? 'Stream interrupted');
    }
    if (done) {
      // Fermé sans le moindre événement : ce n'est pas une réponse vide, c'est une coupure.
      if (!recuQuelqueChose) throw new ErreurLumi('flux_coupe', 'Stream closed before any event');
      break;
    }
    tampon += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = tampon.indexOf('\n\n')) !== -1) {
      const brut = tampon.slice(0, sep);
      tampon = tampon.slice(sep + 2);
      let type = 'message';
      const donnees: string[] = [];
      for (const ligne of brut.split('\n')) {
        if (ligne.startsWith('event:')) type = ligne.slice(6).trim();
        else if (ligne.startsWith('data:')) donnees.push(ligne.slice(5).trim());
      }
      if (!donnees.length) continue;
      try {
        recuQuelqueChose = true;
        onEvent({ ...(JSON.parse(donnees.join('\n')) as object), type } as EvenementFlux);
      } catch {
        /* événement illisible : on continue */
      }
    }
  }
}

/**
 * POST qui renvoie un flux SSE, avec rejeu unique sur 401 (jeton périmé).
 * Renvoie la réponse brute quand `statutsSansFlux` la couvre (ex. 422).
 */
async function posterFlux(
  chemin: string,
  corps: unknown,
  onEvent: (e: EvenementFlux) => void,
  signal: AbortSignal | undefined,
  statutsSansFlux: number[] = [],
): Promise<number> {
  if (!BASE) throw new ErreurLumi('no_base', 'Server URL not configured (EXPO_PUBLIC_WEB_URL).');

  // Le tour est abandonné s'il ne dit rien pendant TIMEOUT_MS.
  const minuteur = new AbortController();
  const t = setTimeout(() => minuteur.abort(), TIMEOUT_MS);
  const onExterne = () => minuteur.abort();
  signal?.addEventListener('abort', onExterne);

  const envoyer = async (jeton: string) =>
    fetchStream(`${BASE}/api${chemin}`, {
      method: 'POST',
      headers: await entetes(jeton),
      body: JSON.stringify(corps),
      signal: minuteur.signal,
    }) as unknown as Promise<Response>;

  try {
    let jeton = await jetonFrais();
    if (!jeton) throw new ErreurLumi('no_session', 'Not signed in.');
    let res: Response;
    try {
      res = await envoyer(jeton);
    } catch (e) {
      if (signal?.aborted) return 0;
      if (minuteur.signal.aborted) throw new ErreurLumi('timeout', 'Timed out');
      throw new ErreurLumi('reseau', (e as Error)?.message ?? 'Network request failed.');
    }

    // Jeton refusé → on le rafraîchit et on rejoue UNE fois.
    if (res.status === 401) {
      const neuf = await jetonFrais(true);
      if (neuf && neuf !== jeton) {
        jeton = neuf;
        res = await envoyer(jeton);
      }
    }
    if (statutsSansFlux.includes(res.status)) return res.status;
    await lireFlux(res, onEvent, signal);
    return res.status;
  } finally {
    clearTimeout(t);
    signal?.removeEventListener('abort', onExterne);
  }
}

/** Appel simple (JSON), avec le même rejeu sur 401. */
async function appel<T>(chemin: string, init?: { method?: string; body?: unknown }): Promise<T> {
  if (!BASE) throw new ErreurLumi('no_base', 'Server URL not configured (EXPO_PUBLIC_WEB_URL).');
  const envoyer = async (jeton: string) =>
    fetch(`${BASE}/api${chemin}`, {
      method: init?.method ?? 'GET',
      headers: await entetes(jeton),
      ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });

  let jeton = await jetonFrais();
  if (!jeton) throw new ErreurLumi('no_session', 'Not signed in.');
  let res: Response;
  try {
    res = await envoyer(jeton);
  } catch (e) {
    throw new ErreurLumi('reseau', (e as Error)?.message ?? 'Network request failed.');
  }
  if (res.status === 401) {
    const neuf = await jetonFrais(true);
    if (neuf && neuf !== jeton) {
      jeton = neuf;
      res = await envoyer(jeton);
    }
  }
  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new ErreurLumi(json?.code || `http_${res.status}`, json?.error || `HTTP ${res.status}`, json?.credits);
  return json as T;
}

/* ────────────────────────────────────────────────────────────────────────
   Les routes — identiques au web
   ──────────────────────────────────────────────────────────────────────── */

/** D'où vient un message (mesure côté serveur) : jamais une autorisation. */
export type OrigineMessageLumi = 'texte' | 'suggestion' | 'voix' | 'repli' | 'lien';

export async function envoyerMessageLumi(
  params: { conversation_id: string | null; message: string; language: 'fr' | 'en'; origine?: OrigineMessageLumi },
  onEvent: (e: EvenementFlux) => void,
  signal?: AbortSignal,
): Promise<void> {
  await posterFlux('/lumi/chat', params, onEvent, signal);
}

/** Action d'interface (étage 0) : une suggestion part avec son nom et ses paramètres, jamais en texte à interpréter. */
export type ActionLumi =
  | 'clients-total' | 'agenda' | 'revenu-mois' | 'retards' | 'briefing' | 'top-clients'
  | 'taches' | 'equipe' | 'devis-attente' | 'ou-equipe' | 'job-numero';
export interface SuggestionLumi {
  label: string;
  action: ActionLumi;
  params?: Record<string, string | number | boolean>;
}

/** Renvoie 'indisponible' (422 : rôle sans accès, outil en échec) pour que l'écran envoie le texte au modèle à la place. */
export async function executerActionLumi(
  params: { conversation_id: string | null; action: ActionLumi; params?: Record<string, string | number | boolean>; label: string; language: 'fr' | 'en'; origine?: 'suggestion' | 'lien' },
  onEvent: (e: EvenementFlux) => void,
  signal?: AbortSignal,
): Promise<'ok' | 'indisponible'> {
  const statut = await posterFlux('/lumi/action', params, onEvent, signal, [422]);
  return statut === 422 ? 'indisponible' : 'ok';
}

export async function deciderPropositionLumi(
  params: { conversation_id: string; tool_use_id: string; decision: 'confirm' | 'cancel'; language: 'fr' | 'en' },
  onEvent: (e: EvenementFlux) => void,
  signal?: AbortSignal,
): Promise<void> {
  await posterFlux('/lumi/execute', params, onEvent, signal);
}

/** Mode de confirmation, par personne : demander | argent | tout. */
export type ModeLumi = 'demander' | 'argent' | 'tout';

export async function modeLumi(): Promise<ModeLumi> {
  return (await appel<{ mode: ModeLumi }>('/lumi/mode')).mode;
}
export async function definirModeLumi(mode: ModeLumi): Promise<ModeLumi> {
  return (await appel<{ mode: ModeLumi }>('/lumi/mode', { method: 'PUT', body: { mode } })).mode;
}

/** Outils d'écriture que l'utilisateur a choisi de ne plus confirmer, côté serveur. */
export async function listerAutorisationsLumi(): Promise<string[]> {
  return (await appel<{ tools: string[] }>('/lumi/autorisations')).tools;
}
export async function definirAutorisationLumi(tool: string, actif: boolean): Promise<string[]> {
  return (await appel<{ tools: string[] }>('/lumi/autorisations', { method: 'PUT', body: { tool, actif } })).tools;
}

export async function quotaLumi(): Promise<QuotaLumi> {
  return appel<QuotaLumi>('/lumi/quota');
}

/** État des crédits seul — même contenu que `quotaLumi().credits`. */
export async function creditsLumi(): Promise<EtatCredits> {
  return appel<EtatCredits>('/lumi/credits');
}

/** Historique de consommation ; `par_utilisateur` est null sans la permission. */
export async function historiqueCreditsLumi(jours = 30): Promise<HistoriqueCredits> {
  return appel<HistoriqueCredits>(`/lumi/credits/historique?jours=${encodeURIComponent(String(jours))}`);
}

export async function listerConversationsLumi(): Promise<ConversationLumi[]> {
  return (await appel<{ conversations?: ConversationLumi[] }>('/lumi/conversations')).conversations ?? [];
}

export async function chargerConversationLumi(id: string): Promise<{ conversation: ConversationLumi; messages: MessageLumi[]; usage?: UsageLumi }> {
  return appel(`/lumi/conversations/${encodeURIComponent(id)}`);
}

export async function supprimerConversationLumi(id: string): Promise<void> {
  await appel(`/lumi/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/* ────────────────────────────────────────────────────────────────────────
   Dictée — le MÊME endpoint et le MÊME modèle que le web (Gemini, côté serveur).
   ──────────────────────────────────────────────────────────────────────── */

/** Types audio acceptés par le serveur (server/lib/agent/transcribe.ts). */
export type TypeAudioLumi = 'audio/webm' | 'audio/mp4' | 'audio/ogg' | 'audio/wav' | 'audio/mpeg' | 'audio/aac';

export async function transcrireAudioLumi(base64: string, mimeType: TypeAudioLumi, language: 'fr' | 'en'): Promise<string> {
  const json = await appel<{ text?: string }>('/agent/transcribe', { method: 'POST', body: { audio: base64, mimeType, language } });
  return json.text ?? '';
}
