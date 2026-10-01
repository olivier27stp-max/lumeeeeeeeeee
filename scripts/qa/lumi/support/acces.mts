/**
 * Batterie de l'agent de support — l'accès à la production (réseau).
 * ─────────────────────────────────────────────────────────────────────────
 * Mêmes portes que les tests critiques de Lumi (critiques/acces.mts, dont on
 * reprend la connexion et le SELECT en lecture seule) :
 *  1. `sql` : des SELECT par l'API de gestion, en `read_only: true` ;
 *  2. la clé de service : ouvrir et fermer les sessions des comptes de test, et,
 *     en repli seulement, poser le statut « closed » sur un ticket de la batterie ;
 *  3. l'API de Lume, à l'identité des comptes de test.
 *
 * Deux limites de débit du serveur cadrent le client (server/index.ts, server/routes/support.ts) :
 *  - 5 requêtes par minute et par personne sur TOUT /api/support (fenêtre fixe, en mémoire) :
 *    un appel toutes les 13 s au plus par compte, fermetures comprises ;
 *  - 60 messages par heure et par personne sur /support/chat (préréglage « lumi »).
 * Un appel en échec de réseau n'est JAMAIS rejoué : le serveur a peut-être déjà ouvert le
 * ticket (ou escaladé), un second envoi en ouvrirait un autre.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { clientService, connexionProd, sqlLectureSeule, type Connexion } from '../critiques/acces.mts';
import type { ClientSupport, ReponseChat, Session } from './types.mts';

export { clientService, connexionProd, sqlLectureSeule, type Connexion };

const SANS_SESSION = { auth: { persistSession: false, autoRefreshToken: false } } as const;
const attendre = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms));

/** Le budget d'appels de la passe ou la limite horaire du serveur est atteinte : le test est NON COUVERT, pas en échec. */
export class LimiteAtteinte extends Error {}
/** La batterie doit s'arrêter tout de suite (un envoi réel à l'équipe, une migration démarrée). */
export class ArretImmediat extends Error {}

/** Ouvre la session d'un compte de test : lien magique (clé de service), puis `verifyOtp` sur un client À PART. */
export async function ouvrirSession(cx: Connexion, admin: SupabaseClient, cle: string, courriel: string): Promise<Session> {
  const { data: lien, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: courriel });
  if (error || !lien?.properties?.hashed_token) throw new Error(`lien magique de ${courriel} : ${error?.message ?? 'jeton absent'}`);
  const otp = createClient(cx.url, cx.anon, SANS_SESSION);
  const { data, error: e2 } = await otp.auth.verifyOtp({ token_hash: lien.properties.hashed_token, type: 'magiclink' });
  if (e2 || !data.session) throw new Error(`session de ${courriel} : ${e2?.message ?? 'absente'}`);
  return { cle, courriel, userId: data.session.user.id, jeton: data.session.access_token, rafraichir: data.session.refresh_token };
}

/** Ferme CETTE session seulement (portée « local » : la portée par défaut couperait les sessions des autres). */
export async function fermerSession(admin: SupabaseClient, s: Session): Promise<void> {
  await admin.auth.admin.signOut(s.jeton, 'local').catch(() => undefined);
}

/** Secondes à attendre d'après un 429 (en-tête Retry-After, ou « … dans N secondes » du message). */
export function delaiDu429(retryAfter: string | null, corps: string): number {
  const entete = Number(retryAfter);
  if (retryAfter && Number.isFinite(entete) && entete > 0) return entete;
  const m = /(\d+)\s*(seconde|second|s\b)/i.exec(corps);
  if (m) return Number(m[1]);
  const min = /(\d+)\s*min/i.exec(corps);
  return min ? Number(min[1]) * 60 : 20;
}

const objet = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Lit le corps JSON de POST /api/support/chat. Pur. */
export function lireReponseChat(statut: number, brut: string): Pick<ReponseChat, 'statut' | 'reponse' | 'escalade' | 'ticket_id' | 'ticket_statut' | 'corps'> {
  let json: unknown = brut.slice(0, 600);
  try { json = JSON.parse(brut); } catch { /* corps non JSON : gardé en texte */ }
  const j = objet(json);
  const ticket = objet(j.ticket);
  if (statut !== 200) return { statut, reponse: null, escalade: false, ticket_id: null, ticket_statut: null, corps: json };
  return {
    statut, corps: null,
    reponse: typeof j.reply === 'string' ? j.reply : null,
    escalade: j.escalated === true,
    ticket_id: typeof ticket.id === 'string' ? ticket.id : null,
    ticket_statut: typeof ticket.status === 'string' ? ticket.status : null,
  };
}

export function creerClientSupport(o: {
  api: string; org: string; cx: Connexion;
  /** Appels à /support/chat permis par compte dans cette passe (le serveur en accepte 60 par heure et par personne). */
  maxParCompte: Record<string, number>;
  dire: (texte: string) => void;
  /** Délai minimal entre deux requêtes d'un même compte sur /api/support (défaut 13 s : 5 par minute au plus). */
  intervalleMs?: number;
  /** Heure de la base moins heure du poste, en ms : le début et la fin d'un tour sont donnés dans l'horloge de la base. */
  decalageMs?: number;
}): ClientSupport {
  const faits: Record<string, number> = {};
  const dernier: Record<string, number> = {};
  const anon = createClient(o.cx.url, o.cx.anon, SANS_SESSION);
  const intervalle = o.intervalleMs ?? 13_000;
  const maintenant = (): Date => new Date(Date.now() + (o.decalageMs ?? 0));

  const cadence = async (cle: string): Promise<void> => {
    const reste = (dernier[cle] ?? 0) + intervalle - Date.now();
    if (reste > 0) await attendre(reste);
    dernier[cle] = Date.now();
  };
  const entetes = (s: Session): Record<string, string> => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${s.jeton}`, 'x-org-id': o.org, Connection: 'close' });
  const rafraichir = async (s: Session): Promise<boolean> => {
    const { data } = await anon.auth.refreshSession({ refresh_token: s.rafraichir });
    if (!data.session) return false;
    s.jeton = data.session.access_token;
    s.rafraichir = data.session.refresh_token;
    return true;
  };

  /** Un POST sur /api/support. Rejoué seulement quand le serveur l'a REFUSÉ avant de le traiter (429, 401). */
  async function poster(s: Session, chemin: string, corps: unknown, compter: boolean): Promise<{ statut: number; brut: string; debut: string; fin: string; duree_ms: number }> {
    for (let essai = 0; essai < 4; essai += 1) {
      if (compter && essai === 0) {
        if ((faits[s.cle] ?? 0) >= (o.maxParCompte[s.cle] ?? 0)) throw new LimiteAtteinte(`budget d'appels de la passe atteint pour le compte ${s.cle} (${o.maxParCompte[s.cle] ?? 0})`);
        faits[s.cle] = (faits[s.cle] ?? 0) + 1;
      }
      await cadence(s.cle);
      const debut = maintenant();
      let res: Response;
      try {
        res = await fetch(`${o.api}${chemin}`, { method: 'POST', headers: entetes(s), body: JSON.stringify(corps), signal: AbortSignal.timeout(120_000) });
      } catch (err) {
        // Réseau coupé, délai dépassé, redéploiement : on ne rejoue pas (le serveur a peut-être traité la demande).
        return { statut: 0, brut: err instanceof Error ? err.message : String(err), debut: debut.toISOString(), fin: maintenant().toISOString(), duree_ms: maintenant().getTime() - debut.getTime() };
      }
      const brut = await res.text().catch(() => '');
      const fin = maintenant();
      if (res.status === 429) {
        const secondes = delaiDu429(res.headers.get('retry-after'), brut);
        if (secondes > 90) throw new LimiteAtteinte(`limite horaire du support atteinte pour ${s.cle} (réessayer dans ${Math.ceil(secondes / 60)} min)`);
        o.dire(`  429 (${s.cle}) : attente de ${secondes + 2} s`);
        await attendre((secondes + 2) * 1000);
        continue;
      }
      if (res.status === 401 && essai < 3 && (await rafraichir(s))) continue;
      return { statut: res.status, brut, debut: debut.toISOString(), fin: fin.toISOString(), duree_ms: fin.getTime() - debut.getTime() };
    }
    throw new LimiteAtteinte(`limite de débit persistante pour ${s.cle}`);
  }

  return {
    async demander(s, message, opts = {}): Promise<ReponseChat> {
      const corps = { message, ...(opts.humain ? { humain: true } : {}), ...(opts.ticketId ? { ticketId: opts.ticketId } : {}) };
      const r = await poster(s, '/api/support/chat', corps, true);
      return { ...lireReponseChat(r.statut, r.brut), duree_ms: r.duree_ms, debut: r.debut, fin: r.fin };
    },
    async fermer(s, ticketId): Promise<number> {
      const r = await poster(s, `/api/support/${ticketId}/close`, {}, false);
      return r.statut;
    },
    compteurs: () => ({ ...faits }),
  };
}
