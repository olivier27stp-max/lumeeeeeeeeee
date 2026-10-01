/**
 * Bac à sable des envois — par entreprise.
 *
 * POURQUOI
 * Prouver qu'une automatisation marche exige de la déclencher pour de vrai :
 * vrai moteur, vrais événements, vraies lignes en base. Mais un texto, un
 * courriel ou un webhook qui part ne se rattrape pas. `QA_REDIRECT_*` ne
 * suffit pas : il redirige TOUT le serveur vers une vraie boîte (≈ 80
 * courriels à l'équipe le 2026-09-29).
 *
 * CE QUE FAIT CE MODULE
 * Une entreprise inscrite dans `orgs_envois_simules` n'envoie RIEN : chaque
 * texto, courriel et webhook sortant est écrit dans `envois_simules` (ce qui
 * AURAIT été envoyé, mot pour mot) et l'appelant reçoit une réussite
 * simulée. Tout le reste du chemin (moteur, gabarits, désabonnement,
 * plafonds, journaux) s'exécute à l'identique : on ne remplace que le
 * fournisseur, jamais la chose testée.
 *
 * DEUX FILETS INDÉPENDANTS
 *  1. L'entreprise : lue dans `orgs_envois_simules` (cache 30 s), passée
 *     explicitement par l'appelant ou portée par `contexteEnvoi`
 *     (AsyncLocalStorage posé par `executeAction`).
 *  2. Le destinataire : un numéro de la plage fictive nord-américaine
 *     (555-0100 à 555-0199) ou une adresse en `lume-qa.test` / `.invalid`
 *     (RFC 2606) ne reçoit jamais rien, quelle que soit
 *     l'entreprise. Toutes les données du bureau de test s'y trouvent : si le
 *     premier filet rate un appelant, le second le rattrape.
 *
 * PANNE SIMULÉE
 * `mode = 'panne'` fait échouer le fournisseur simulé (erreur levée) et
 * `mode = 'delai'` le fait expirer : les tests de reprise éprouvent le vrai
 * moteur sans toucher au vrai fournisseur.
 *
 * SÛRETÉ
 * Une lecture ratée de la liste ne coupe JAMAIS les envois d'une vraie
 * entreprise (on garde la dernière liste connue) ; le bureau de test reste
 * protégé par le second filet.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { logger } from './logger';

export type CanalSimule = 'sms' | 'courriel' | 'webhook';
export type ModeBacASable = 'succes' | 'panne' | 'delai';

/** Contexte d'envoi : l'entreprise pour qui le code s'exécute. */
export const contexteEnvoi = new AsyncLocalStorage<{ orgId: string | null }>();

export function orgDuContexte(): string | null {
  return contexteEnvoi.getStore()?.orgId ?? null;
}

/**
 * Ouvre un contexte d'envoi pour CHAQUE requête HTTP (monté dans index.ts,
 * après les analyseurs de corps). Sans lui, seul le moteur d'automatisations
 * connaissait l'entreprise : un courriel envoyé par une route directe (envoi
 * manuel, outil de Lumi) depuis un bureau en bac à sable PARTAIT pour de vrai
 * dès que le destinataire n'était pas fictif (canari du 2026-10-01 : consigné
 * avec org_id = null, raison = « destinataire »).
 */
export function contexteEnvoiParRequete() {
  return (_req: unknown, _res: unknown, next: () => void): void => {
    contexteEnvoi.run({ orgId: null }, next);
  };
}

/**
 * L'entreprise authentifiée de la requête en cours. On MODIFIE le contexte
 * ouvert par `contexteEnvoiParRequete` : un `enterWith` posé dans une
 * fonction attendue (`await requireAuthedClient`) ne remonterait pas à
 * l'appelant. Hors requête (cron, tâche de fond) : sans effet.
 */
export function poserOrgDuContexte(orgId: string | null | undefined): void {
  const contexte = contexteEnvoi.getStore();
  if (contexte && orgId) contexte.orgId = orgId;
}

const DUREE_CACHE_MS = 30_000;
let cache: { modes: Map<string, ModeBacASable>; expire: number } | null = null;
let lectureEnCours: Promise<Map<string, ModeBacASable>> | null = null;

/** Pour les tests : relire la liste au prochain appel. */
export function oublierBacASable(): void {
  cache = null;
}

async function lireListe(): Promise<Map<string, ModeBacASable>> {
  if (cache && cache.expire > Date.now()) return cache.modes;
  if (lectureEnCours) return lectureEnCours;
  // Tests unitaires : aucune lecture réseau (leurs `fetch` simulés
  // compteraient cet appel). La suite d'intégration, elle, pose
  // BAC_A_SABLE_EN_TEST=1 (tests/automations-suite/harnais/env-integration.ts).
  if (process.env.VITEST && process.env.BAC_A_SABLE_EN_TEST !== '1') return new Map();
  lectureEnCours = (async () => {
    try {
      // Import tardif : config.ts importe ce module, et supabase.ts lit config.
      const { getServiceClient } = await import('./supabase');
      const { data, error } = await getServiceClient()
        .from('orgs_envois_simules')
        .select('org_id, mode');
      if (error) throw new Error(error.message);
      const modes = new Map<string, ModeBacASable>();
      for (const l of data ?? []) modes.set(String(l.org_id), (l.mode as ModeBacASable) || 'succes');
      cache = { modes, expire: Date.now() + DUREE_CACHE_MS };
      return modes;
    } catch (err) {
      logger.error('[bac-a-sable] liste illisible — dernière liste connue conservée', {
        error: err instanceof Error ? err.message : String(err),
      });
      const modes = cache?.modes ?? new Map<string, ModeBacASable>();
      cache = { modes, expire: Date.now() + 5_000 };
      return modes;
    } finally {
      lectureEnCours = null;
    }
  })();
  return lectureEnCours;
}

/** Numéro fictif (555-0100 à 555-0199) ou domaine réservé aux tests. */
export function destinataireFictif(destinataire: string): boolean {
  const v = String(destinataire || '').trim().toLowerCase();
  if (!v) return false;
  // Domaine du bureau de test seulement (et `.invalid`, jamais routable) : un
  // `.test` générique servirait à d'autres tests qui, eux, éprouvent l'envoi.
  if (v.includes('@')) return /[@.]lume-qa\.test$/.test(v) || /\.invalid$/.test(v);
  const chiffres = v.replace(/\D/g, '');
  const national = chiffres.length === 11 && chiffres.startsWith('1') ? chiffres.slice(1) : chiffres;
  return national.length === 10 && /^\d{3}55501\d{2}$/.test(national);
}

export interface VerdictBacASable {
  simule: boolean;
  mode: ModeBacASable;
  orgId: string | null;
  raison: 'entreprise' | 'destinataire' | null;
}

/**
 * Cet envoi doit-il être simulé ? `orgId` explicite d'abord, sinon celui du
 * contexte. Un seul destinataire fictif suffit à simuler tout l'envoi.
 */
export async function verdictBacASable(
  orgId: string | null | undefined,
  destinataires: string | string[],
): Promise<VerdictBacASable> {
  const org = orgId || orgDuContexte();
  if (org) {
    const mode = (await lireListe()).get(org);
    if (mode) return { simule: true, mode, orgId: org, raison: 'entreprise' };
  }
  const liste = Array.isArray(destinataires) ? destinataires : [destinataires];
  if (liste.some(destinataireFictif)) return { simule: true, mode: 'succes', orgId: org, raison: 'destinataire' };
  return { simule: false, mode: 'succes', orgId: org, raison: null };
}

/**
 * Écrit l'envoi simulé, puis applique le mode : `panne` lève, `delai` lève
 * une expiration. Renvoie l'identifiant de la ligne (sert d'identifiant de
 * message factice).
 */
export async function consignerEnvoiSimule(
  verdict: VerdictBacASable,
  envoi: { canal: CanalSimule; destinataire: string; sujet?: string | null; corps?: string | null; meta?: Record<string, unknown> },
): Promise<string> {
  const id = randomUUID();
  const { getServiceClient } = await import('./supabase');
  const { error } = await getServiceClient().from('envois_simules').insert({
    id,
    org_id: verdict.orgId,
    canal: envoi.canal,
    destinataire: String(envoi.destinataire || '').slice(0, 500),
    sujet: envoi.sujet ?? null,
    corps: envoi.corps ?? null,
    meta: { ...(envoi.meta ?? {}), raison: verdict.raison, mode: verdict.mode },
  });
  if (error) {
    // Rien n'est parti de toute façon : on le dit, on n'envoie pas pour autant.
    logger.error('[bac-a-sable] envoi simulé non journalisé', { canal: envoi.canal, error: error.message });
  }
  if (verdict.mode === 'panne') throw new Error('Fournisseur simulé en panne (bac à sable)');
  if (verdict.mode === 'delai') {
    const e = new Error('Délai dépassé — fournisseur simulé (bac à sable)');
    e.name = 'TimeoutError';
    throw e;
  }
  return id;
}

/**
 * Enveloppe un client Twilio : un texto d'une entreprise en bac à sable (ou
 * vers un numéro fictif) est consigné, jamais transmis. Posé à l'EXTÉRIEUR
 * de la redirection QA : le bac à sable passe avant tout envoi réel.
 */
export function envelopperBacASable<T extends { messages: { create: (opts: any) => any } }>(client: T | null): T | null {
  if (!client) return null;
  const creationOrigine = client.messages.create.bind(client.messages);
  const creation = async (opts: any) => {
    const verdict = await verdictBacASable(null, String(opts?.to || ''));
    if (!verdict.simule) return creationOrigine(opts);
    const id = await consignerEnvoiSimule(verdict, {
      canal: 'sms',
      destinataire: String(opts?.to || ''),
      corps: String(opts?.body || ''),
      meta: { from: opts?.from ?? null },
    });
    return { sid: `SM_SIMULE_${id.replace(/-/g, '')}`, status: 'queued', to: opts?.to, from: opts?.from, body: opts?.body };
  };
  return new Proxy(client, {
    get(cible, prop, recepteur) {
      if (prop !== 'messages') return Reflect.get(cible, prop, recepteur);
      const messages = Reflect.get(cible, prop, recepteur);
      return new Proxy(messages, {
        get(m, p, r) {
          if (p === 'create') return creation;
          const v = Reflect.get(m, p, r);
          return typeof v === 'function' ? v.bind(m) : v;
        },
      });
    },
  }) as T;
}
