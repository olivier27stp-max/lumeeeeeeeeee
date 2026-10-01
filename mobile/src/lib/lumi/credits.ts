/**
 * Crédits Lumi — types, textes et mise en forme. Aucun appel réseau, aucun
 * composant : tout ce qui se teste sans rendre un écran vit ici.
 *
 * Depuis le 2026-09-30, l'usage IA de Lumi se compte en CRÉDITS, jamais en
 * dollars. Règle du propriétaire : **aucun montant ni aucune équivalence en
 * dollars liés à l'IA ne s'affiche au client, nulle part** — ni coût par
 * réponse, ni « 1 crédit = X $ ». Ce module ne manipule donc que des crédits.
 *
 * Parité web : les gabarits sont copiés tels quels de `src/i18n/{fr,en}.ts`
 * (clé `lumiCredits`) et la logique de `src/lib/lumiCreditsFormat.ts` +
 * `src/components/lumi/CreditsLumi.tsx` du dépôt web, livrés en prod le
 * 2026-09-30 (PR #817 et #824). Le libellé de l'unité est UNE seule clé
 * (`unit`), pour pouvoir le renommer d'un coup.
 */

export type LangueCredits = 'fr' | 'en';

/** État des crédits de la période en cours (contrat serveur, 2026-09-30). */
export interface EtatCredits {
  /** Le forfait inclut Lumi. */
  inclus: boolean;
  /** Crédits de la période (ex. 1000). */
  total: number;
  /** Entier, arrondi vers le bas. */
  utilises: number;
  /** Entier ≥ 0, arrondi vers le bas. */
  restants: number;
  /** 0..100, entier (utilisés / total). */
  pourcentage: number;
  /** 'YYYY-MM-DD', date LOCALE du bureau — jamais convertie de fuseau. */
  renouvellement_le: string;
  palier: 'normal' | 'econome' | 'restreint' | 'epuise';
  /** '80' = au moins 80 % utilisés ; '100' = épuisé. */
  avertissement: null | '80' | '100';
}

export interface HistoriqueCredits {
  periode_debut: string;
  renouvellement_le: string;
  /** Crédits avec une décimale. */
  par_jour: Array<{ jour: string; credits: number }>;
  /** null si l'utilisateur n'a pas la permission « administrer Lumi ». */
  par_utilisateur: null | Array<{ user_id: string; nom: string; credits: number }>;
}

/**
 * Crédits inclus dans Autopilot, pour un texte de vente hors session. L'app
 * lit toujours le vrai chiffre du serveur (`/api/lumi/credits`).
 */
export const CREDITS_LUMI_AUTOPILOT = 1000;

/* ────────────────────────────────────────────────────────────────────────
   Textes — copiés à l'identique du web (src/i18n/{fr,en}.ts → lumiCredits)
   ──────────────────────────────────────────────────────────────────────── */

export const TEXTES_CREDITS = {
  fr: {
    unit: 'crédits Lumi',
    counter: '{restants} / {total} {unit}',
    renews: 'renouvellement le {date}',
    renewsOn: 'Renouvellement le {date}',
    untilRenewal: 'renouvellement',
    barLabel: '{unit} restants pour la période',
    barValue: '{restants} {unit} restants sur {total}',
    warn80: 'Il te reste {n} {unit} jusqu’au {date}.',
    exhausted: 'Tes {unit} sont épuisés jusqu’au {date}. Les actions rapides et tout le reste de Lume fonctionnent toujours.',
    exhaustedInput: '{Unit} épuisés jusqu’au {date}.',
    slowed: 'Lumi ménage tes {unit} : il répond une fois par minute jusqu’au {date}. Réessaie dans un instant.',
    perMonth: '{n} {unit} / mois',
    deducted: 'Déduit de tes {unit}',
    left: 'restants',
    ofTotal: 'sur {total}',
    noRollover: 'Les {unit} non utilisés ne sont pas reportés. Le compteur repart à chaque renouvellement.',
    historyTitle: '30 derniers jours',
    historyEmpty: 'Aucune consommation pour l’instant dans cette période.',
    historyError: 'L’historique de consommation est indisponible pour le moment.',
    byUser: 'Par utilisateur',
    dayUsage: '{jour} : {n} {unit}',
    planIncludes: 'Lumi est inclus dans le forfait Autopilot.',
  },
  en: {
    unit: 'Lumi credits',
    counter: '{restants} / {total} {unit}',
    renews: 'renews {date}',
    renewsOn: 'Renews on {date}',
    untilRenewal: 'renewal',
    barLabel: '{unit} left this period',
    barValue: '{restants} of {total} {unit} left',
    warn80: 'You have {n} {unit} left until {date}.',
    exhausted: 'Your {unit} are used up until {date}. Quick actions and everything else in Lume still work.',
    exhaustedInput: '{Unit} used up until {date}.',
    slowed: 'Lumi is saving your {unit}: one reply per minute until {date}. Try again in a moment.',
    perMonth: '{n} {unit} / month',
    deducted: 'Uses your {unit}',
    left: 'left',
    ofTotal: 'of {total}',
    noRollover: 'Unused {unit} do not roll over. The count restarts at each renewal.',
    historyTitle: 'Last 30 days',
    historyEmpty: 'No usage yet this period.',
    historyError: 'Usage history is unavailable for now.',
    byUser: 'By user',
    dayUsage: '{jour}: {n} {unit}',
    planIncludes: 'Lumi is included in the Autopilot plan.',
  },
} as const;

/** Les textes d'une langue. Les composants mobiles reçoivent `fr`, pas un `t`. */
export function textesCredits(langue: LangueCredits) {
  return TEXTES_CREDITS[langue];
}

/** Le libellé de l'unité (« crédits Lumi » / « Lumi credits »). */
export function uniteCredits(langue: LangueCredits): string {
  return TEXTES_CREDITS[langue].unit;
}

/* ────────────────────────────────────────────────────────────────────────
   Mise en forme
   ──────────────────────────────────────────────────────────────────────── */

/** Remplit un gabarit : « Il te reste {n} {unit} » + { n: '12', unit: 'crédits Lumi' }. */
export function remplir(gabarit: string, valeurs: Record<string, string | number>): string {
  return gabarit.replace(/\{(\w+)\}/g, (tout: string, cle: string, position: number) => {
    if (!(cle in valeurs)) return tout;
    const v = String(valeurs[cle]);
    // « jusqu'au {date}. » avec date = « 12 nov. » : pas de double point.
    return v.endsWith('.') && gabarit.charAt(position + tout.length) === '.' ? v.slice(0, -1) : v;
  });
}

/** Première lettre en majuscule (« crédits Lumi » → « Crédits Lumi »). */
export function majuscule(texte: string): string {
  return texte ? texte.charAt(0).toLocaleUpperCase() + texte.slice(1) : texte;
}

/** 1000 → « 1 000 » (fr) / « 1,000 » (en). Entiers à l'écran, 1 décimale pour l'historique. */
export function fmtCredits(n: number, langue: LangueCredits, decimales = 0): string {
  return n.toLocaleString(langue === 'fr' ? 'fr-CA' : 'en-CA', { minimumFractionDigits: 0, maximumFractionDigits: decimales });
}

/**
 * 'YYYY-MM-DD' → « 12 nov. » (fr) / « Nov 12 » (en) ; `long` ajoute l'année.
 *
 * La date est lue comme une date LOCALE : `new Date('2026-11-12')` serait
 * minuit UTC, donc le 11 au soir à Montréal — le renouvellement s'afficherait
 * un jour trop tôt. On passe donc par le constructeur (an, mois, jour).
 */
export function fmtDateCredits(iso: string | null | undefined, langue: LangueCredits, long = false): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(
    langue === 'fr' ? 'fr-CA' : 'en-CA',
    long ? { day: 'numeric', month: 'long', year: 'numeric' } : { day: 'numeric', month: 'short' },
  );
}

/** « 1 000 crédits Lumi / mois » / « 1,000 Lumi credits / month ». */
export function creditsParMois(langue: LangueCredits, n: number = CREDITS_LUMI_AUTOPILOT): string {
  const c = TEXTES_CREDITS[langue];
  return remplir(c.perMonth, { n: fmtCredits(n, langue), unit: c.unit });
}

/* ────────────────────────────────────────────────────────────────────────
   État affiché
   ──────────────────────────────────────────────────────────────────────── */

/** Crédits épuisés : le serveur le dit par le palier ou l'avertissement ; restants = 0 suffit aussi. */
export function creditsEpuises(c: EtatCredits | null | undefined): boolean {
  if (!c || !c.inclus) return false;
  return c.palier === 'epuise' || c.avertissement === '100' || c.restants <= 0;
}

/**
 * L'état à afficher, en un mot :
 *  - `absent`  : pas de crédits connus, ou le forfait n'inclut pas Lumi → pas
 *                de compteur du tout (on garde « Lumi est inclus dans Autopilot ») ;
 *  - `normal`  : compteur seul ;
 *  - `avert80` : compteur + avis « Il te reste N crédits Lumi jusqu'au … » ;
 *  - `epuise`  : compteur + avis d'épuisement, saisie et micro désactivés.
 */
export type EtatAffiche = 'absent' | 'normal' | 'avert80' | 'epuise';

export function etatCredits(c: EtatCredits | null | undefined): EtatAffiche {
  if (!c || !c.inclus) return 'absent';
  if (creditsEpuises(c)) return 'epuise';
  if (c.avertissement === '80') return 'avert80';
  return 'normal';
}

/** Les crédits bloquent-ils l'envoi (saisie et micro) ? */
export function creditsBloquent(c: EtatCredits | null | undefined): boolean {
  return etatCredits(c) === 'epuise';
}

/* ────────────────────────────────────────────────────────────────────────
   Libellés prêts à rendre — testés sans rendre d'écran
   ──────────────────────────────────────────────────────────────────────── */

export interface LibellesCompteur {
  /** « 742 / 1 000 crédits Lumi ». */
  compteur: string;
  /** « renouvellement le 12 nov. ». */
  renouvellement: string;
  /** Le tout, tel qu'il s'affiche : « 742 / 1 000 crédits Lumi · renouvellement le 12 nov. ». */
  complet: string;
  /** Étiquette d'accessibilité de la barre. */
  barLabel: string;
  /** Valeur lue de la barre : « 742 crédits Lumi restants sur 1 000 ». */
  barValue: string;
  /** Part RESTANTE, 0..100 — la barre montre ce qui reste, pas ce qui est consommé. */
  pctRestant: number;
}

export function libellesCompteur(credits: EtatCredits, langue: LangueCredits): LibellesCompteur {
  const c = TEXTES_CREDITS[langue];
  const unit = c.unit;
  const Unit = majuscule(unit);
  const restants = Math.max(0, Math.floor(credits.restants));
  const total = Math.max(0, Math.floor(credits.total));
  const date = fmtDateCredits(credits.renouvellement_le, langue) ?? c.untilRenewal;
  const valeurs = { restants: fmtCredits(restants, langue), total: fmtCredits(total, langue), unit, Unit };
  const compteur = remplir(c.counter, valeurs);
  const renouvellement = remplir(c.renews, { date });
  return {
    compteur,
    renouvellement,
    complet: `${compteur} · ${renouvellement}`,
    barLabel: majuscule(remplir(c.barLabel, { unit, Unit })),
    barValue: remplir(c.barValue, valeurs),
    pctRestant: total > 0 ? Math.min(100, Math.max(0, Math.round((restants / total) * 100))) : 0,
  };
}

/** L'avis à montrer, ou null sous 80 %. */
export function libelleAvis(credits: EtatCredits | null | undefined, langue: LangueCredits): string | null {
  const etat = etatCredits(credits);
  if (etat === 'absent' || etat === 'normal') return null;
  const c = TEXTES_CREDITS[langue];
  const unit = c.unit;
  const Unit = majuscule(unit);
  const date = fmtDateCredits(credits!.renouvellement_le, langue) ?? c.untilRenewal;
  if (etat === 'epuise') return remplir(c.exhausted, { unit, Unit, date });
  return remplir(c.warn80, { n: fmtCredits(Math.max(0, Math.floor(credits!.restants)), langue), unit, Unit, date });
}

/** Le texte de la saisie désactivée (« Crédits Lumi épuisés jusqu'au 12 nov. »), ou null. */
export function libelleSaisieBloquee(credits: EtatCredits | null | undefined, langue: LangueCredits): string | null {
  if (!creditsBloquent(credits)) return null;
  const c = TEXTES_CREDITS[langue];
  const date = fmtDateCredits(credits!.renouvellement_le, langue) ?? c.untilRenewal;
  return remplir(c.exhaustedInput, { unit: c.unit, Unit: majuscule(c.unit), date });
}
