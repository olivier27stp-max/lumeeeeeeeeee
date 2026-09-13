/**
 * Magasin clé-valeur des caches de Lumi (items 13 et 15).
 * ────────────────────────────────────────────────────
 * Upstash Redis (REST, mêmes variables que le limiteur : UPSTASH_REDIS_REST_URL
 * / _TOKEN) quand il est configuré ; sinon une Map en mémoire avec TTL, par
 * processus. Le comportement est le même dans les deux cas : `get` renvoie
 * null quand la clé est absente ou expirée ; `set` prend un TTL en secondes ;
 * rien ne lève jamais (un cache qui casse = un cache qui rate).
 *
 * Toutes les clés commencent par `lumi:` ; la clé d'un cache de données
 * client contient TOUJOURS l'org et la personne (voir cache-reponses.ts et
 * cache-semantique.ts) — c'est ici que la fuite inter-tenant serait
 * possible, donc c'est ici qu'on refuse une clé sans préfixe connu.
 */
import { Redis } from '@upstash/redis';
import { logger } from '../logger';

export interface Magasin {
  get<T>(cle: string): Promise<T | null>;
  set(cle: string, valeur: unknown, ttlSecondes: number): Promise<void>;
  del(cle: string): Promise<void>;
  /** Incrémente un compteur (version d'org) et renvoie la nouvelle valeur. */
  incr(cle: string): Promise<number>;
}

const PREFIXES_PERMIS = ['lumi:rep:', 'lumi:sem:', 'lumi:ver:'];
function verifierCle(cle: string): void {
  if (!PREFIXES_PERMIS.some((p) => cle.startsWith(p))) throw new Error(`clé de cache hors préfixe : ${cle.slice(0, 30)}`);
}

class MagasinMemoire implements Magasin {
  private m = new Map<string, { v: unknown; exp: number }>();
  async get<T>(cle: string): Promise<T | null> {
    const e = this.m.get(cle);
    if (!e) return null;
    if (e.exp <= Date.now()) { this.m.delete(cle); return null; }
    return e.v as T;
  }
  async set(cle: string, valeur: unknown, ttl: number): Promise<void> {
    verifierCle(cle);
    this.m.set(cle, { v: valeur, exp: Date.now() + ttl * 1000 });
    // Borne : un processus ne garde jamais plus de 5 000 entrées (les plus vieilles partent).
    if (this.m.size > 5000) { const k = this.m.keys().next().value; if (k !== undefined) this.m.delete(k); }
  }
  async del(cle: string): Promise<void> { this.m.delete(cle); }
  async incr(cle: string): Promise<number> {
    verifierCle(cle);
    const n = (Number((await this.get<number>(cle)) ?? 0) || 0) + 1;
    this.m.set(cle, { v: n, exp: Date.now() + 30 * 86_400_000 });
    return n;
  }
  /** Tests. */
  vider(): void { this.m.clear(); }
}

class MagasinRedis implements Magasin {
  constructor(private r: Redis) {}
  async get<T>(cle: string): Promise<T | null> {
    try { return (await this.r.get<T>(cle)) ?? null; } catch (e: any) { logger.warn('[lumi/magasin] lecture ratée', { error: e?.message }); return null; }
  }
  async set(cle: string, valeur: unknown, ttl: number): Promise<void> {
    verifierCle(cle);
    try { await this.r.set(cle, valeur, { ex: ttl }); } catch (e: any) { logger.warn('[lumi/magasin] écriture ratée', { error: e?.message }); }
  }
  async del(cle: string): Promise<void> {
    try { await this.r.del(cle); } catch (e: any) { logger.warn('[lumi/magasin] suppression ratée', { error: e?.message }); }
  }
  async incr(cle: string): Promise<number> {
    verifierCle(cle);
    try { return await this.r.incr(cle); } catch (e: any) { logger.warn('[lumi/magasin] incr raté', { error: e?.message }); return Date.now(); }
  }
}

let instance: Magasin | null = null;
export function magasin(): Magasin {
  if (instance) return instance;
  const url = process.env.UPSTASH_REDIS_REST_URL, token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    try { instance = new MagasinRedis(new Redis({ url, token })); logger.info('[lumi/magasin] caches sur Upstash Redis'); return instance; }
    catch (e: any) { logger.warn('[lumi/magasin] Redis indisponible, caches en mémoire', { error: e?.message }); }
  }
  instance = new MagasinMemoire();
  return instance;
}

/** Tests : un magasin mémoire neuf, injecté à la place du global. */
export function magasinPourTests(): Magasin & { vider(): void } {
  const m = new MagasinMemoire();
  instance = m;
  return m;
}
