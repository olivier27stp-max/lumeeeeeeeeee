/**
 * Appel SORTANT vers une adresse choisie par une entreprise (action
 * « webhook » des automatisations) — sans SSRF.
 *
 * Launch 2026-09-28. L'ancienne garde lisait seulement le TEXTE de l'adresse :
 * un nom de domaine qui pointe vers 127.0.0.1, `[::1]`, `0.0.0.0`, 100.64/10,
 * une redirection vers le réseau interne… passaient. Ici :
 *   · https seulement ;
 *   · le nom est RÉSOLU et chaque adresse obtenue doit être publique
 *     (privée, boucle locale, link-local, 0.0.0.0, IPv6 locale, multicast,
 *     réservée : refusées). Les formes décimales ou hexadécimales d'IPv4
 *     (`2130706433`, `0x7f.1`) sont ramenées à la forme pointée par l'URL
 *     avant la vérification ;
 *   · l'IP est revérifiée AU MOMENT DE LA CONNEXION (résolution maison
 *     d'undici) : un DNS qui change entre la vérification et l'appel ne passe
 *     pas ;
 *   · pas de redirection suivie aveuglément : chaque saut est revérifié
 *     (3 au plus) ;
 *   · délai total borné.
 */
import dns from 'node:dns';
import net from 'node:net';
import { Agent } from 'undici';

/** Une IP (v4 ou v6) est-elle NON publique ? */
export function ipNonPublique(ip: string): boolean {
  const brute = ip.replace(/^\[|\]$/g, '');
  if (net.isIPv4(brute)) {
    const [a, b] = brute.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 192 && b === 0)
      || (a === 198 && (b === 18 || b === 19))
    );
  }
  if (net.isIPv6(brute)) {
    const v6 = brute.toLowerCase();
    // IPv4 encapsulée (::ffff:1.2.3.4 ou ::ffff:7f00:1) : on juge l'IPv4.
    const mappee = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
    if (mappee) return ipNonPublique(mappee[1]);
    const hexa = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(v6);
    if (hexa) {
      const n = (parseInt(hexa[1], 16) << 16) | parseInt(hexa[2], 16);
      return ipNonPublique([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'));
    }
    return (
      v6 === '::' || v6 === '::1'
      || /^f[cd]/.test(v6) // fc00::/7 (adresses locales uniques)
      || /^fe[89ab]/.test(v6) // fe80::/10 (link-local)
      || /^ff/.test(v6) // multicast
      || v6.startsWith('64:ff9b:') // NAT64
      || v6.startsWith('2001:db8:') // documentation
    );
  }
  return true; // pas une IP : on ne sait pas, donc non
}

const NOMS_INTERNES = /(^localhost$|\.local$|\.internal$|\.localhost$)/i;

/** Vérifie le TEXTE de l'adresse (avant toute résolution). */
export function adresseAcceptable(url: string): { ok: true; hote: string } | { ok: false; raison: string } {
  let u: URL;
  try { u = new URL(url); } catch { return { ok: false, raison: 'adresse invalide' }; }
  if (u.protocol !== 'https:') return { ok: false, raison: 'https:// seulement' };
  if (u.username || u.password) return { ok: false, raison: 'identifiants dans l’adresse refusés' };
  const hote = u.hostname.replace(/^\[|\]$/g, '');
  if (NOMS_INTERNES.test(hote)) return { ok: false, raison: 'adresse interne' };
  if (net.isIP(hote) && ipNonPublique(hote)) return { ok: false, raison: 'adresse IP non publique' };
  return { ok: true, hote };
}

type Resolveur = (hote: string) => Promise<Array<{ address: string }>>;
const resoudreParDefaut: Resolveur = (hote) => dns.promises.lookup(hote, { all: true, verbatim: true });

/** Toutes les adresses du nom doivent être publiques. */
export async function resolutionPublique(hote: string, resoudre: Resolveur = resoudreParDefaut): Promise<boolean> {
  if (net.isIP(hote)) return !ipNonPublique(hote);
  try {
    const adresses = await resoudre(hote);
    return adresses.length > 0 && adresses.every((a) => !ipNonPublique(a.address));
  } catch {
    return false;
  }
}

/** Connexion qui refuse une IP non publique AU MOMENT de se connecter (anti « DNS rebinding »). */
const agentSur = new Agent({
  connect: {
    lookup(hostname, options, rappel) {
      dns.lookup(hostname, { ...options, all: true, verbatim: true }, (err, adresses) => {
        if (err) return rappel(err, '', 4);
        const liste = (adresses as unknown as dns.LookupAddress[]);
        const publique = liste.find((a) => !ipNonPublique(a.address));
        if (!publique || liste.some((a) => ipNonPublique(a.address))) {
          return rappel(new Error('adresse IP non publique'), '', 4);
        }
        if ((options as { all?: boolean }).all) return (rappel as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, liste);
        return rappel(null, publique.address, publique.family);
      });
    },
  },
});

export const SAUTS_MAX = 3;
export const DELAI_TOTAL_MS = 10_000;

/**
 * POST JSON vers une adresse externe, sûr. Lève une Error au message lisible
 * si l'adresse (ou une redirection) est refusée.
 */
export async function posterSansSsrf(
  url: string,
  corps: unknown,
  options: { resoudre?: Resolveur; fetcher?: typeof fetch } = {},
): Promise<Response> {
  const fetcher = options.fetcher ?? fetch;
  const abandon = AbortSignal.timeout(DELAI_TOTAL_MS);
  let cible = url;
  for (let saut = 0; saut <= SAUTS_MAX; saut++) {
    const verdict = adresseAcceptable(cible);
    if (!verdict.ok) throw new Error(`Adresse refusée : ${verdict.raison}.`);
    if (!(await resolutionPublique(verdict.hote, options.resoudre))) {
      throw new Error('Adresse refusée : elle ne pointe pas vers une adresse publique.');
    }
    const reponse = await fetcher(cible, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Lume-Automations/1' },
      body: JSON.stringify(corps),
      redirect: 'manual',
      signal: abandon,
      // @ts-expect-error — option undici (fetch natif de Node) : IP revérifiée à la connexion.
      dispatcher: agentSur,
    });
    if (reponse.status >= 300 && reponse.status < 400 && reponse.headers.get('location')) {
      cible = new URL(reponse.headers.get('location') as string, cible).toString();
      continue;
    }
    return reponse;
  }
  throw new Error(`Adresse refusée : plus de ${SAUTS_MAX} redirections.`);
}
