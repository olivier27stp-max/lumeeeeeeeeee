/**
 * Robustesse des conversations de Lumi — l'accès à la production (réseau).
 * ─────────────────────────────────────────────────────────────────────────
 * Mêmes portes que les tests critiques (`../critiques/acces.mts`) : des SELECT en lecture seule par l'API de
 * gestion, la clé de service pour ouvrir les sessions et poser le mode Lumi, et l'API de Lume à l'identité des
 * comptes de test. Connexion par lien magique puis `verifyOtp` sur un client supabase-js À PART ; fermeture par
 * `auth.admin.signOut(jeton, 'local')` seulement.
 *
 * Ce qui est propre à cette batterie :
 *  - le flux est lu AU FIL DE L'EAU, pour pouvoir le couper au premier texte, à la carte, ou après un délai ;
 *  - un flux qui se ferme sans « done » ni « error » alors que la batterie ne l'a pas coupé lève `FluxInterrompu`
 *    (le lanceur décide : redéploiement = NON COUVERT) ;
 *  - CHAQUE envoi à /api/lumi/chat compte dans le budget du compte, même refusé : le limiteur horaire du serveur
 *    passe avant la validation ;
 *  - « Confirmer » relit d'abord la conversation et refuse tout ce qui n'est pas une tâche [ROB].
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { LimiteAtteinte, type Connexion } from '../critiques/acces.mts';
import { echangeVide, lireFlux } from '../critiques/jugement.mts';
import { ecrituresEnAttente, evenementComplet, gardeConfirmation, type CauseInterruption } from './jugement.mts';
import type { ClientLumi, Compte, ConversationRendue, Coupure, GardeDeConfirmation, MessageRendu, OptionsTour, Sante, Session, Tour } from './types.mts';
import { COMPTES } from './types.mts';

export { LimiteAtteinte, clientService, connexionProd, sqlLectureSeule, type Connexion } from '../critiques/acces.mts';

const SANS_SESSION = { auth: { persistSession: false, autoRefreshToken: false } } as const;

/** Ouvre UNE session du compte. Appelée deux fois pour le même compte, elle rend deux jetons distincts (« web » et « mobile »). */
export async function ouvrirSession(cx: Connexion, admin: SupabaseClient, compte: Compte, courriel: string, appareil: Session['appareil'] = 'web'): Promise<Session> {
  const { data: lien, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: courriel });
  if (error || !lien?.properties?.hashed_token) throw new Error(`lien magique de ${courriel} : ${error?.message ?? 'jeton absent'}`);
  const otp = createClient(cx.url, cx.anon, SANS_SESSION);
  const { data, error: e2 } = await otp.auth.verifyOtp({ token_hash: lien.properties.hashed_token, type: 'magiclink' });
  if (e2 || !data.session) throw new Error(`session de ${courriel} : ${e2?.message ?? 'absente'}`);
  return { compte, courriel, userId: data.session.user.id, jeton: data.session.access_token, rafraichir: data.session.refresh_token, appareil };
}

/** Ferme CETTE session seulement (portée « local » : la portée par défaut couperait les sessions des autres). */
export async function fermerSession(admin: SupabaseClient, s: Session): Promise<void> {
  await admin.auth.admin.signOut(s.jeton, 'local').catch(() => undefined);
}

/** Le flux s'est fermé sans « done » ni « error », et ce n'est pas la batterie qui l'a coupé. */
export class FluxInterrompu extends Error {
  constructor(public cause_interruption: CauseInterruption, public detail: string, public partiel: Tour | null = null) { super(`flux interrompu (${cause_interruption}) : ${detail}`); }
}
/** La batterie refuse de confirmer : une écriture en attente n'est pas une tâche [ROB]. Rien n'a été envoyé. */
export class ConfirmationRefusee extends Error {}

const attendre = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms));
const nombre = (v: string | null): number | null => (v !== null && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
/** La limite horaire de Lumi : 60 envois par personne (server/lib/rate-limiter.ts, préréglage « lumi »). */
export const LIMITE_HORAIRE = 60;

/**
 * L'attente annoncée par un 429, en secondes : l'en-tête Retry-After (limite horaire), sinon le champ `retryAfter`,
 * sinon le délai écrit dans le message (« Réessayez dans 37 secondes », « dans 12 minutes » : la limite à la minute
 * n'envoie pas d'en-tête).
 */
export function attenteAnnoncee(enTete: string | null, corps: unknown): number | null {
  const h = nombre(enTete);
  if (h !== null) return h;
  const c = corps && typeof corps === 'object' ? (corps as Record<string, unknown>) : {};
  if (typeof c.retryAfter === 'number' && Number.isFinite(c.retryAfter)) return c.retryAfter;
  const message = typeof c.error === 'string' ? c.error : '';
  const minutes = /(\d+)\s*minute/i.exec(message);
  if (minutes) return Number(minutes[1]) * 60;
  const secondes = /(\d+)\s*second/i.exec(message);
  return secondes ? Number(secondes[1]) : null;
}
const TYPE_DE_COUPURE = { texte: 'text', carte: 'proposal', recu: 'executed' } as const;

export function creerClientLumi(o: {
  api: string; org: string; cx: Connexion;
  /** Envois à /api/lumi/chat permis par compte dans cette passe (le serveur en accepte 60 par heure et par personne, refus compris). */
  maxParCompte: Record<Compte, number>;
  dire: (texte: string) => void;
  /** Délai minimal entre deux appels d'un même compte (défaut 2,5 s : le serveur accepte 30 requêtes par minute et par personne sur /api/lumi). */
  intervalleMs?: number;
  /** Délai au bout duquel un flux sans fin est abandonné (défaut 180 s). */
  delaiMs?: number;
}): ClientLumi {
  const zero = <T,>(v: T): Record<Compte, T> => Object.fromEntries(COMPTES.map((c) => [c, v])) as Record<Compte, T>;
  const faits = zero(0);
  const dernier = zero(0);
  const restants = zero<number | null>(null);
  const ouvertes: string[] = [];
  const anon = createClient(o.cx.url, o.cx.anon, SANS_SESSION);
  const intervalle = o.intervalleMs ?? 2500;
  const delai = o.delaiMs ?? 180_000;

  const cadence = async (c: Compte): Promise<void> => {
    const reste = dernier[c] + intervalle - Date.now();
    dernier[c] = Math.max(Date.now(), dernier[c] + intervalle);
    if (reste > 0) await attendre(reste);
  };
  const entetes = (s: Session): Record<string, string> => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${s.jeton}`, 'x-org-id': o.org, Connection: 'close' });
  const rafraichir = async (s: Session): Promise<boolean> => {
    const { data } = await anon.auth.refreshSession({ refresh_token: s.rafraichir });
    if (!data.session) return false;
    s.jeton = data.session.access_token;
    s.rafraichir = data.session.refresh_token;
    return true;
  };

  /** UN envoi, lu au fil de l'eau, coupé où on le demande. Aucune reprise ici. */
  async function poster(s: Session, chemin: string, corps: unknown, couper?: Coupure): Promise<Tour> {
    const debut = Date.now();
    const controleur = new AbortController();
    let coupe = false;
    let horsDelai = false;
    const minuteur = setTimeout(() => { horsDelai = true; controleur.abort(); }, delai);
    const minuteurCoupure = couper && 'apres_ms' in couper ? setTimeout(() => { coupe = true; controleur.abort(); }, couper.apres_ms) : null;
    const vide = (statut: number, json: unknown = null): Tour => ({ ...echangeVide(statut, json), duree_ms: Date.now() - debut, coupe, termine: false, restant: null, retry_after: null, est_flux: false });
    try {
      let res: Response;
      try {
        res = await fetch(`${o.api}${chemin}`, { method: 'POST', headers: entetes(s), body: JSON.stringify(corps), signal: controleur.signal });
      } catch (err) {
        if (coupe) return vide(0);
        throw new FluxInterrompu(horsDelai ? 'delai' : 'reseau', `${chemin} : ${horsDelai ? `aucune réponse en ${Math.round(delai / 1000)} s` : err instanceof Error ? err.message : String(err)}`);
      }
      // Le limiteur général pose les mêmes en-têtes (400 par minute et par adresse) : seul un plafond de 60 est la limite horaire de Lumi.
      const horaire = nombre(res.headers.get('x-ratelimit-limit')) === LIMITE_HORAIRE;
      const limite = { restant: horaire ? nombre(res.headers.get('x-ratelimit-remaining')) : null, retry_after: nombre(res.headers.get('retry-after')) };
      if (chemin === '/api/lumi/chat' && limite.restant !== null) restants[s.compte] = limite.restant;
      const estFlux = (res.headers.get('content-type') ?? '').includes('text/event-stream');
      if (!(res.ok && estFlux)) {
        const brut = await res.text().catch(() => '');
        let json: unknown = brut.slice(0, 600);
        try { json = JSON.parse(brut); } catch { /* corps non JSON : gardé en texte */ }
        return { ...vide(res.status, json), restant: limite.restant, retry_after: res.status === 429 ? attenteAnnoncee(res.headers.get('retry-after'), json) : limite.retry_after };
      }
      let brut = '';
      if (couper && 'apres' in couper && couper.apres === 'entete') { coupe = true; controleur.abort(); }
      const lecteur = res.body?.getReader();
      const decodeur = new TextDecoder();
      while (lecteur && !coupe) {
        let lu: ReadableStreamReadResult<Uint8Array>;
        try {
          lu = await lecteur.read();
        } catch (err) {
          if (coupe) break;
          const partiel: Tour = { ...lireFlux(brut), statut: res.status, corps: null, duree_ms: Date.now() - debut, coupe: false, termine: false, ...limite, est_flux: true };
          throw new FluxInterrompu(horsDelai ? 'delai' : 'reseau', `${chemin} : ${horsDelai ? `flux sans fin après ${Math.round(delai / 1000)} s` : err instanceof Error ? err.message : String(err)}`, partiel);
        }
        if (lu.done) break;
        brut += decodeur.decode(lu.value, { stream: true });
        if (couper && 'apres' in couper && couper.apres !== 'entete' && evenementComplet(brut, TYPE_DE_COUPURE[couper.apres])) { coupe = true; controleur.abort(); }
      }
      if (coupe) await lecteur?.cancel().catch(() => undefined);
      const flux = lireFlux(brut);
      const termine = flux.evenements.some((e) => e.type === 'done' || e.type === 'error');
      const tour: Tour = { ...flux, statut: res.status, corps: null, duree_ms: Date.now() - debut, coupe, termine, ...limite, est_flux: true };
      if (!termine && !coupe) throw new FluxInterrompu('ferme_sans_fin', `${chemin} : ${flux.evenements.length} événement(s) reçu(s) en ${Math.round((Date.now() - debut) / 1000)} s, dernier : ${flux.evenements.at(-1)?.type ?? 'aucun'}`, tour);
      if (flux.conversation_id && !ouvertes.includes(flux.conversation_id)) ouvertes.push(flux.conversation_id);
      return tour;
    } finally {
      clearTimeout(minuteur);
      if (minuteurCoupure) clearTimeout(minuteurCoupure);
    }
  }

  const compter = (s: Session, horsBudget = false): void => {
    if (!horsBudget && faits[s.compte] >= o.maxParCompte[s.compte]) throw new LimiteAtteinte(`budget d'appels de la passe atteint pour le compte ${s.compte} (${o.maxParCompte[s.compte]})`);
    faits[s.compte] += 1;
  };

  async function demander(s: Session, message: string, opts: OptionsTour = {}): Promise<Tour> {
    const corps = { conversation_id: opts.conversation_id ?? null, message, language: opts.langue ?? 'fr', ...(opts.origine ? { origine: opts.origine } : {}) };
    for (let essai = 0; essai < 4; essai++) {
      compter(s);
      if (!opts.sans_cadence) await cadence(s.compte);
      const t = await poster(s, '/api/lumi/chat', corps, opts.couper);
      if (t.statut === 429) {
        const secondes = t.retry_after ?? 20;
        if (secondes > 90) throw new LimiteAtteinte(`limite horaire de Lumi atteinte pour ${s.compte} (${s.courriel}) : réessayer dans ${Math.ceil(secondes / 60)} min`);
        o.dire(`  429 (${s.compte}) : limite à la minute, attente de ${secondes + 2} s`);
        await attendre((secondes + 2) * 1000);
        continue;
      }
      if (t.statut === 401 && essai < 3 && (await rafraichir(s))) continue;
      if (opts.conversation_id && !ouvertes.includes(opts.conversation_id)) ouvertes.push(opts.conversation_id);
      return t;
    }
    throw new LimiteAtteinte(`limite de débit persistante pour ${s.compte}`);
  }

  async function decider(s: Session, conversationId: string, toolUseId: string, decision: 'cancel' | 'confirm', opts: { couper?: Coupure; sans_cadence?: boolean } = {}): Promise<Tour> {
    for (let essai = 0; essai < 3; essai++) {
      if (!opts.sans_cadence) await cadence(s.compte);
      const t = await poster(s, '/api/lumi/execute', { conversation_id: conversationId, tool_use_id: toolUseId, decision, language: 'fr' }, opts.couper);
      if (t.statut === 429 && essai < 2 && (t.retry_after ?? 20) <= 90) { await attendre(((t.retry_after ?? 20) + 2) * 1000); continue; }
      if (t.statut === 401 && essai < 2 && (await rafraichir(s))) continue;
      return t;
    }
    throw new LimiteAtteinte(`limite de débit persistante pour ${s.compte} (décision de carte)`);
  }

  async function appel(s: Session, methode: 'GET' | 'POST', chemin: string, opts: { corps?: unknown } = {}): Promise<{ statut: number; json: unknown; texte: string }> {
    for (let essai = 0; essai < 3; essai++) {
      await cadence(s.compte);
      const res = await fetch(`${o.api}${chemin}`, { method: methode, headers: entetes(s), signal: AbortSignal.timeout(60_000), ...(opts.corps !== undefined ? { body: JSON.stringify(opts.corps) } : {}) });
      const texte = await res.text();
      let json: unknown = null;
      try { json = JSON.parse(texte); } catch { /* pas du JSON */ }
      // Une limite à la minute : on attend et on reprend. Une limite longue (plafond du jour, limite horaire) est rendue telle quelle.
      const attente = res.status === 429 ? attenteAnnoncee(res.headers.get('retry-after'), json) ?? 20 : 0;
      if (res.status === 429 && essai < 2 && attente <= 90) { await attendre((attente + 2) * 1000); continue; }
      if (res.status === 401 && essai < 2 && (await rafraichir(s))) continue;
      return { statut: res.status, json, texte: texte.slice(0, 2000) };
    }
    return { statut: 429, json: null, texte: 'limite de débit persistante' };
  }

  async function conversation(s: Session, conversationId: string): Promise<ConversationRendue> {
    const r = await appel(s, 'GET', `/api/lumi/conversations/${encodeURIComponent(conversationId)}`);
    const messages = r.json && typeof r.json === 'object' && Array.isArray((r.json as { messages?: unknown }).messages) ? ((r.json as { messages: MessageRendu[] }).messages) : [];
    return { statut: r.statut, messages, brut: r.json ?? r.texte };
  }

  /**
   * Garde-fou : « Confirmer » exécute TOUT le groupe en attente. La conversation est relue, et la batterie n'envoie
   * rien si une seule écriture en attente n'est pas une tâche [ROB].
   */
  async function verifierGarde(s: Session, conversationId: string, toolUseId: string, garde: GardeDeConfirmation): Promise<void> {
    const c = await conversation(s, conversationId);
    if (c.statut !== 200) throw new ConfirmationRefusee(`REFUS : la conversation n’a pas pu être relue avant de confirmer (statut ${c.statut}).`);
    const g = gardeConfirmation(ecrituresEnAttente(c.messages), toolUseId, garde);
    if (!g.permis) throw new ConfirmationRefusee(`REFUS : la batterie ne confirme pas — ${g.raisons.join(' ; ')}.`);
  }

  return {
    demander,
    async envoyerBrut(s, corps, opts = {}) {
      compter(s, opts.hors_budget === true);
      if (!opts.sans_cadence) await cadence(s.compte);
      let t = await poster(s, '/api/lumi/chat', corps, opts.couper);
      if (t.statut === 401 && (await rafraichir(s))) { compter(s, opts.hors_budget === true); t = await poster(s, '/api/lumi/chat', corps, opts.couper); }
      return t;
    },
    annuler: (s, conversationId, toolUseId) => decider(s, conversationId, toolUseId, 'cancel'),
    async confirmer(s, conversationId, toolUseId, garde: GardeDeConfirmation, opts = {}) {
      await verifierGarde(s, conversationId, toolUseId, garde);
      return decider(s, conversationId, toolUseId, 'confirm', opts);
    },
    async preparerConfirmation(s, conversationId, toolUseId, garde: GardeDeConfirmation) {
      await verifierGarde(s, conversationId, toolUseId, garde);
      return () => decider(s, conversationId, toolUseId, 'confirm', { sans_cadence: true });
    },
    conversation,
    appel,
    async transcrire(s, audioBase64, mime) {
      const r = await appel(s, 'POST', '/api/agent/transcribe', { corps: { audio: audioBase64, mimeType: mime, language: 'fr' } });
      return r;
    },
    async sante(): Promise<Sante> {
      try {
        const res = await fetch(`${o.api}/api/health`, { signal: AbortSignal.timeout(20_000), headers: { Connection: 'close' } });
        const j = (await res.json().catch(() => null)) as { uptime?: unknown } | null;
        const uptime = res.ok && j && typeof j.uptime === 'number' ? j.uptime : null;
        return { ok: res.ok && uptime !== null, uptime_s: uptime, demarre_le_ms: uptime === null ? null : Date.now() - uptime * 1000 };
      } catch {
        return { ok: false, uptime_s: null, demarre_le_ms: null };
      }
    },
    compteurs: () => ({ ...faits }),
    restants: () => ({ ...restants }),
    conversations: () => [...ouvertes],
  };
}
