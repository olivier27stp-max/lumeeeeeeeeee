/**
 * Références courtes opaques à la place des UUID.
 * ───────────────────────────────────────────────
 * L'agent ne doit JAMAIS voir un UUID : ni pour l'afficher, ni « en interne ».
 * Reposer sur une instruction « ne montre pas les id » est fragile — l'agent
 * finit par en recracher. Ici on rend le problème structurellement impossible :
 *
 *  - À la SORTIE d'un outil, chaque UUID est remplacé par une réf courte et
 *    lisible : « c1 » (client), « j3 » (job), « f2 » (facture), « d1 » (devis),
 *    « t4 » (tâche), « m1 » (membre)… selon le NOM du champ qui la porte.
 *  - À l'ENTRÉE d'un outil, toute réf courte redevient l'UUID réel avant que le
 *    handler agisse. Un vrai UUID passé directement est laissé tel quel — donc
 *    rien ne casse si l'agent, par habitude, renvoie un UUID.
 *
 * Le mapping vit en mémoire, par (org, porteur), avec une fenêtre glissante :
 * une réf émise reste valable assez longtemps pour être rejouée dans l'appel
 * suivant. Ce n'est pas un identifiant de sécurité (l'org est déjà verrouillée
 * par le token et la RLS) — juste un voile anti-jargon.
 */

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const UUID_RE_G = new RegExp(UUID_RE.source, 'gi');
// Une réf est « ref » + un nombre. Volontairement neutre : le préfixe ne
// cherche pas à deviner le TYPE (client/job/…) — le contexte du champ le dirait
// mal pour un « id » nu, et un mauvais préfixe induirait l'agent en erreur.
// L'important est qu'une réf soit STABLE, OPAQUE et retraduisible.
const REF_RE = /^ref\d+$/;

/**
 * Clé de l'espace des réfs d'UNE conversation.
 *
 * Avant le 2026-10-01 l'espace était par (entreprise, personne), donc commun à
 * toutes ses conversations. Or les réfs sont de simples compteurs : après un
 * redéploiement ou 30 minutes sans activité, une NOUVELLE conversation
 * repartait à « ref1 », et reprendre ensuite une ancienne conversation ne
 * pouvait plus restaurer ses propres « ref1 », « ref2 »… (une réf vivante n'est
 * jamais réécrite). Le « ref3 » que le modèle lisait dans l'ancien historique
 * — le client X — était alors traduit vers la fiche de l'autre conversation —
 * le client Y : une action sur la mauvaise fiche. Un espace par conversation
 * rend la collision impossible.
 *
 * Sans conversation (texto, MCP) : l'espace reste par (entreprise, personne).
 */
export function espaceRefsDe(orgId: string, userId: string, conversationId?: string | null): string {
  return conversationId ? `${orgId}:${userId}:${conversationId}` : `${orgId}:${userId}`;
}

interface Espace {
  refParUuid: Map<string, string>;
  uuidParRef: Map<string, string>;
  compteur: number;
  vu: number;
  /** Numéros tirés de l'identifiant lui-même (voir `refPour`). */
  stable: boolean;
}

const espaces = new Map<string, Espace>();
const TTL_MS = 30 * 60_000; // 30 min : large devant l'aller-retour d'un appel

function espacePour(cle: string, stable = false): Espace {
  // Purge paresseuse des espaces trop vieux, pour ne pas fuir en mémoire.
  const maintenant = Date.now();
  for (const [k, e] of espaces) if (maintenant - e.vu > TTL_MS) espaces.delete(k);
  let e = espaces.get(cle);
  if (!e) {
    e = { refParUuid: new Map(), uuidParRef: new Map(), compteur: 0, vu: maintenant, stable };
    espaces.set(cle, e);
  }
  if (stable) e.stable = true;
  e.vu = maintenant;
  return e;
}

function refPour(e: Espace, uuid: string): string {
  const existante = e.refParUuid.get(uuid);
  if (existante) return existante; // même UUID → toujours la même réf
  // Espace SANS mémoire de conversation (le MCP : c'est l'agent externe qui garde
  // les réfs, dans son propre fil) : un compteur repartirait à 1 après chaque
  // redéploiement, et le « ref5 » que l'agent tient depuis ce matin — le client
  // X — désignerait la 5e fiche lue depuis le redémarrage. Le numéro est donc
  // tiré de l'identifiant lui-même : la même fiche reçoit toujours la même
  // réf, et une réf d'avant le redémarrage, tant que sa fiche n'a pas été
  // relue, reste INCONNUE (« introuvable ») au lieu de viser une autre fiche.
  let ref: string;
  if (e.stable) {
    let n = parseInt(uuid.replace(/-/g, '').slice(0, 8), 16);
    while (e.uuidParRef.has(`ref${n}`)) n += 1; // deux identifiants au même début (une chance sur 4 milliards)
    ref = `ref${n}`;
  } else {
    ref = `ref${++e.compteur}`;
  }
  e.refParUuid.set(uuid, ref);
  e.uuidParRef.set(ref, uuid);
  return ref;
}

/**
 * Remplace récursivement, dans un résultat d'outil, tout UUID par une réf
 * courte. Le nom du champ oriente le préfixe (client_id → c1). Les chaînes qui
 * CONTIENNENT un UUID au milieu d'autre texte (rare) sont aussi nettoyées.
 */
export function masquerIds(cleEspace: string, valeur: any, options?: { stable?: boolean }): any {
  const e = espacePour(cleEspace, options?.stable === true);
  const parcourir = (v: any): any => {
    if (v == null) return v;
    if (typeof v === 'string') {
      if (UUID_RE.test(v)) {
        // Chaîne = exactement un UUID → réf ; sinon on masque l'UUID inclus.
        if (/^[0-9a-f-]{36}$/i.test(v)) return refPour(e, v);
        return v.replace(UUID_RE_G, (u) => refPour(e, u));
      }
      return v;
    }
    if (Array.isArray(v)) return v.map(parcourir);
    if (typeof v === 'object') {
      const out: Record<string, any> = {};
      for (const [k, val] of Object.entries(v)) out[k] = parcourir(val);
      return out;
    }
    return v;
  };
  return parcourir(valeur);
}

/**
 * Instantané du mapping d'un espace (réf → UUID), pour le PERSISTER avec la
 * conversation. Le mapping vit en mémoire : un redéploiement (Railway) ou un
 * second serveur l'efface, et un « ref3 » émis avant devient « introuvable »
 * — vu en prod le 2026-09-10 : « Quote not found » sur une conversion de devis.
 */
export function instantaneRefs(cleEspace: string): Record<string, string> {
  const e = espaces.get(cleEspace);
  if (!e) return {};
  return Object.fromEntries(e.uuidParRef);
}

/** Restaure (fusionne) un instantané dans l'espace : les réfs redeviennent traduisibles après un redémarrage. */
export function restaurerRefs(cleEspace: string, refs: Record<string, string> | null | undefined): void {
  if (!refs || typeof refs !== 'object') return;
  const e = espacePour(cleEspace);
  for (const [ref, uuid] of Object.entries(refs)) {
    if (!REF_RE.test(ref) || typeof uuid !== 'string' || !UUID_RE.test(uuid)) continue;
    if (e.uuidParRef.has(ref) && e.uuidParRef.get(ref) !== uuid) continue; // jamais réécrire une réf vivante
    e.uuidParRef.set(ref, uuid);
    if (!e.refParUuid.has(uuid)) e.refParUuid.set(uuid, ref);
    const n = Number(ref.slice(3));
    if (n > e.compteur) e.compteur = n; // le compteur reprend après la plus haute réf connue
  }
}

/**
 * Avant d'exécuter un outil : retraduit toute réf courte des arguments en UUID
 * réel. Un vrai UUID est laissé tel quel (compat + robustesse). Une réf inconnue
 * (jamais émise, ou expirée) est laissée telle quelle : le handler la rejettera
 * proprement (« introuvable »), ce qui est le bon comportement.
 */
export function demasquerIds(cleEspace: string, args: any): any {
  const e = espaces.get(cleEspace);
  if (!e) return args;
  const parcourir = (v: any): any => {
    if (v == null) return v;
    if (typeof v === 'string') {
      if (REF_RE.test(v)) return e.uuidParRef.get(v) || v;
      return v;
    }
    if (Array.isArray(v)) return v.map(parcourir);
    if (typeof v === 'object') {
      const out: Record<string, any> = {};
      for (const [k, val] of Object.entries(v)) out[k] = parcourir(val);
      return out;
    }
    return v;
  };
  return parcourir(args);
}
