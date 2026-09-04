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

interface Espace {
  refParUuid: Map<string, string>;
  uuidParRef: Map<string, string>;
  compteur: number;
  vu: number;
}

const espaces = new Map<string, Espace>();
const TTL_MS = 30 * 60_000; // 30 min : large devant l'aller-retour d'un appel

function espacePour(cle: string): Espace {
  // Purge paresseuse des espaces trop vieux, pour ne pas fuir en mémoire.
  const maintenant = Date.now();
  for (const [k, e] of espaces) if (maintenant - e.vu > TTL_MS) espaces.delete(k);
  let e = espaces.get(cle);
  if (!e) {
    e = { refParUuid: new Map(), uuidParRef: new Map(), compteur: 0, vu: maintenant };
    espaces.set(cle, e);
  }
  e.vu = maintenant;
  return e;
}

function refPour(e: Espace, uuid: string): string {
  const existante = e.refParUuid.get(uuid);
  if (existante) return existante; // même UUID → toujours la même réf
  const ref = `ref${++e.compteur}`;
  e.refParUuid.set(uuid, ref);
  e.uuidParRef.set(ref, uuid);
  return ref;
}

/**
 * Remplace récursivement, dans un résultat d'outil, tout UUID par une réf
 * courte. Le nom du champ oriente le préfixe (client_id → c1). Les chaînes qui
 * CONTIENNENT un UUID au milieu d'autre texte (rare) sont aussi nettoyées.
 */
export function masquerIds(cleEspace: string, valeur: any): any {
  const e = espacePour(cleEspace);
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
