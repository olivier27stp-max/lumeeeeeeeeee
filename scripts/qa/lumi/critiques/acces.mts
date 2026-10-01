/**
 * Tests critiques de Lumi — l'accès à la production (réseau).
 * ─────────────────────────────────────────────────────────────────────────
 * Trois portes, et rien d'autre :
 *  1. `sql` : des SELECT par l'API de gestion, en `read_only: true` — c'est par
 *     là que la batterie relit les faits (jamais par le code de Lumi) ;
 *  2. la clé de service : seulement pour ouvrir les sessions, poser le mode
 *     Lumi des deux comptes, créer et retirer les fiches [CRIT] du bureau A ;
 *  3. l'API de Lume, à l'identité des comptes de test (jeton de l'utilisateur).
 *
 * Connexion d'un compte : lien magique généré avec la clé de service, puis
 * `verifyOtp` sur un client SÉPARÉ — un client qui a fait `verifyOtp` agit
 * ensuite comme l'utilisateur et perd ses droits de service. Fermeture par
 * `auth.admin.signOut(jeton, 'local')` : la portée par défaut (« global »)
 * couperait les sessions des autres.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { echangeVide, estLectureSeule, lireFlux, type Echange } from './jugement.mts';
import type { ClientLumi, Compte, ReponseHttp, Session } from './types.mts';

export interface Connexion { url: string; service: string; anon: string; ref: string; jetonGestion: string }

const SANS_SESSION = { auth: { persistSession: false, autoRefreshToken: false } } as const;

/** Lit les variables de la prod (jamais affichées) et la clé publique à la source. */
export async function connexionProd(): Promise<Connexion> {
  const ref = process.env.SUPABASE_PROJECT_REF_PROD ?? '';
  const url = process.env.SUPABASE_URL_PROD ?? '';
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY_PROD ?? '';
  const jetonGestion = process.env.SUPABASE_ACCESS_TOKEN ?? '';
  if (!ref || !url || !service || !jetonGestion) throw new Error('SUPABASE_PROJECT_REF_PROD, SUPABASE_URL_PROD, SUPABASE_SERVICE_ROLE_KEY_PROD et SUPABASE_ACCESS_TOKEN requis (node --env-file=…/.env.local).');
  if (!url.includes(ref)) throw new Error('SUPABASE_URL_PROD ne correspond pas à SUPABASE_PROJECT_REF_PROD — refus.');
  // La clé publique de la prod n'est pas dans .env.local (qui pointe sur staging) : on la lit à la source.
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys`, { headers: { Authorization: `Bearer ${jetonGestion}` } });
  if (!r.ok) throw new Error(`clé publique de la prod illisible (${r.status})`);
  const cles = (await r.json()) as Array<{ name: string; api_key: string }>;
  const anon = cles.find((c) => c.name === 'anon')?.api_key ?? '';
  if (!anon) throw new Error('clé publique de la prod introuvable');
  return { url, service, anon, ref, jetonGestion };
}

export function clientService(cx: Connexion): SupabaseClient {
  return createClient(cx.url, cx.service, SANS_SESSION);
}

/** Un SELECT sur la prod, en lecture seule (la base refuse toute écriture sur cette connexion). */
export function sqlLectureSeule(cx: Connexion): <T = Record<string, unknown>>(requete: string) => Promise<T[]> {
  return async <T,>(requete: string): Promise<T[]> => {
    if (!estLectureSeule(requete)) throw new Error(`requête refusée (SELECT seulement) : ${requete.slice(0, 80)}`);
    const r = await fetch(`https://api.supabase.com/v1/projects/${cx.ref}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cx.jetonGestion}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: requete, read_only: true }),
    });
    const corps: unknown = await r.json().catch(() => null);
    if (!r.ok || !Array.isArray(corps)) throw new Error(`SELECT en échec (${r.status}) : ${JSON.stringify(corps).slice(0, 200)}`);
    return corps as T[];
  };
}

export async function ouvrirSession(cx: Connexion, admin: SupabaseClient, compte: Compte, courriel: string): Promise<Session> {
  const { data: lien, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: courriel });
  if (error || !lien?.properties?.hashed_token) throw new Error(`lien magique de ${courriel} : ${error?.message ?? 'jeton absent'}`);
  const otp = createClient(cx.url, cx.anon, SANS_SESSION);
  const { data, error: e2 } = await otp.auth.verifyOtp({ token_hash: lien.properties.hashed_token, type: 'magiclink' });
  if (e2 || !data.session) throw new Error(`session de ${courriel} : ${e2?.message ?? 'absente'}`);
  const s: Session = {
    compte, courriel, userId: data.session.user.id, jeton: data.session.access_token, rafraichir: data.session.refresh_token,
    // Toujours avec le jeton COURANT : un jeton rafraîchi en cours de passe est repris par les lectures de la base.
    get client() { return clientUtilisateur(cx, s); },
  };
  return s;
}

/** Ferme CETTE session seulement (portée « local »). */
export async function fermerSession(admin: SupabaseClient, s: Session): Promise<void> {
  await admin.auth.admin.signOut(s.jeton, 'local').catch(() => undefined);
}

/** Un client PostgREST à l'identité de l'utilisateur, avec des en-têtes en plus (bureau demandé). */
export function clientUtilisateur(cx: Connexion, s: Session, entetes: Record<string, string> = {}): SupabaseClient {
  return createClient(cx.url, cx.anon, { ...SANS_SESSION, global: { headers: { Authorization: `Bearer ${s.jeton}`, ...entetes } } });
}

/** La limite horaire de Lumi est atteinte, ou le budget d'appels de la passe : le test est NON COUVERT, pas en échec. */
export class LimiteAtteinte extends Error {}

/** Outils qu'un test a le droit de CONFIRMER (écritures anodines créées pour l'occasion). Tout le reste se limite à la carte. */
export const CONFIRMABLES: ReadonlySet<string> = new Set(['create_task', 'forget_note']);

const attendre = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms));

export function creerClientLumi(o: {
  api: string; orgA: string; cx: Connexion;
  /** Appels à /lumi/chat permis par compte dans cette passe (la prod en accepte 60 par heure et par personne). */
  maxParCompte: Record<Compte, number>;
  /** Attendre la fin d'une limite horaire (jusqu'à une heure) au lieu de rendre NON COUVERT. */
  attendreLimite: boolean;
  dire: (texte: string) => void;
  /** Délai minimal entre deux appels d'un même compte (défaut 2,5 s : la prod accepte 30 requêtes par minute et par personne sur /api/lumi). */
  intervalleMs?: number;
}): ClientLumi {
  const faits: Record<Compte, number> = { proprietaire: 0, technicien: 0 };
  const dernier: Record<Compte, number> = { proprietaire: 0, technicien: 0 };
  const ouvertes: string[] = [];
  const anon = createClient(o.cx.url, o.cx.anon, SANS_SESSION);

  const intervalle = o.intervalleMs ?? 2500;
  /** 30 requêtes par minute et par personne sur /api/lumi : un appel toutes les 2,5 s au plus. */
  const cadence = async (c: Compte): Promise<void> => {
    const reste = dernier[c] + intervalle - Date.now();
    if (reste > 0) await attendre(reste);
    dernier[c] = Date.now();
  };
  const entetes = (s: Session, plus: Record<string, string> = {}): Record<string, string> => ({
    'Content-Type': 'application/json', Authorization: `Bearer ${s.jeton}`, 'x-org-id': o.orgA, Connection: 'close', ...plus,
  });
  const rafraichir = async (s: Session): Promise<boolean> => {
    const { data } = await anon.auth.refreshSession({ refresh_token: s.rafraichir });
    if (!data.session) return false;
    s.jeton = data.session.access_token;
    s.rafraichir = data.session.refresh_token;
    return true;
  };

  /** Un POST qui répond par un flux d'événements (ou par un refus en JSON). */
  async function flux(s: Session, chemin: string, corps: unknown, plus: Record<string, string>, compter: boolean): Promise<Echange> {
    const debut = Date.now();
    for (let essai = 0; essai < 4; essai++) {
      if (compter) {
        if (faits[s.compte] >= o.maxParCompte[s.compte]) throw new LimiteAtteinte(`budget d'appels de la passe atteint pour le compte ${s.compte} (${o.maxParCompte[s.compte]})`);
        faits[s.compte] += 1;
      }
      await cadence(s.compte);
      const res = await fetch(`${o.api}${chemin}`, { method: 'POST', headers: entetes(s, plus), body: JSON.stringify(corps), signal: AbortSignal.timeout(180_000) });
      const brut = await res.text();
      if (res.status === 429) {
        const secondes = Number(res.headers.get('retry-after') ?? /(\d+)\s*seconde/.exec(brut)?.[1] ?? 20);
        if (secondes > 90 && !o.attendreLimite) throw new LimiteAtteinte(`limite horaire de Lumi atteinte pour ${s.compte} (réessayer dans ${Math.ceil(secondes / 60)} min, ou relancer avec --attendre)`);
        o.dire(`  429 (${s.compte}) : attente de ${secondes + 2} s`);
        await attendre((secondes + 2) * 1000);
        continue;
      }
      if (res.status === 401 && essai < 3 && (await rafraichir(s))) continue;
      const estFlux = (res.headers.get('content-type') ?? '').includes('text/event-stream');
      if (res.ok && estFlux) {
        const lu = lireFlux(brut);
        if (lu.conversation_id && !ouvertes.includes(lu.conversation_id)) ouvertes.push(lu.conversation_id);
        return { ...lu, statut: res.status, corps: null, duree_ms: Date.now() - debut };
      }
      let json: unknown = brut.slice(0, 600);
      try { json = JSON.parse(brut); } catch { /* corps non JSON : gardé en texte */ }
      return { ...echangeVide(res.status, json), duree_ms: Date.now() - debut };
    }
    throw new LimiteAtteinte(`limite de débit persistante pour ${s.compte}`);
  }

  async function decider(s: Session, conversationId: string, toolUseId: string, decision: 'cancel' | 'confirm'): Promise<{ statut: number; echange: Echange | null; json: unknown }> {
    const e = await flux(s, '/api/lumi/execute', { conversation_id: conversationId, tool_use_id: toolUseId, decision, language: 'fr' }, {}, false);
    return { statut: e.statut, echange: e.statut === 200 ? e : null, json: e.corps };
  }

  return {
    demander: (s, message, opts = {}) => flux(s, '/api/lumi/chat', { conversation_id: opts.conversation_id ?? null, message, language: opts.langue ?? 'fr' }, opts.entetes ?? {}, true),
    annuler: (s, conversationId, toolUseId) => decider(s, conversationId, toolUseId, 'cancel'),
    confirmer: (s, conversationId, toolUseId, outil) => {
      // Garde-fou : la batterie ne confirme JAMAIS un envoi, un paiement ou une suppression.
      if (!CONFIRMABLES.has(outil)) throw new Error(`REFUS : la batterie ne confirme pas « ${outil} » (permis : ${[...CONFIRMABLES].join(', ')}).`);
      return decider(s, conversationId, toolUseId, 'confirm');
    },
    async appel(s, methode, chemin, opts = {}): Promise<ReponseHttp> {
      for (let essai = 0; essai < 3; essai++) {
        await cadence(s.compte);
        const res = await fetch(`${o.api}${chemin}`, {
          method: methode, headers: entetes(s, opts.entetes ?? {}), signal: AbortSignal.timeout(60_000),
          ...(opts.corps !== undefined ? { body: JSON.stringify(opts.corps) } : {}),
        });
        const texte = await res.text();
        if (res.status === 429 && essai < 2) { await attendre((Number(res.headers.get('retry-after') ?? 20) + 2) * 1000); continue; }
        if (res.status === 401 && essai < 2 && (await rafraichir(s))) continue;
        let json: unknown = null;
        try { json = JSON.parse(texte); } catch { /* pas du JSON */ }
        return { statut: res.status, json, texte: texte.slice(0, 2000) };
      }
      return { statut: 429, json: null, texte: 'limite de débit persistante' };
    },
    compteurs: () => ({ ...faits }),
    conversations: () => [...ouvertes],
  };
}
