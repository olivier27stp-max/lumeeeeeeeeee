/* ═══════════════════════════════════════════════════════════════
   GARDE D'ENVOI — les règles que TOUT courriel respecte, vérifiées au
   dernier moment, dans `sendEmail` (server/lib/mailer.ts), le passage
   obligé de tous les envois.

   1. Aucun lien vers une adresse non publique (localhost, 127.0.0.1,
      réseau privé, *.local). Audit du 2026-09-29 : des courriels réels
      sont partis avec « http://localhost:5173/… » depuis des instances de
      test qui envoyaient par SES. Un lien cassé chez un client ne se
      rattrape pas : on REFUSE l'envoi, bruyamment (journal + Sentry).
      Seule exception : le mode QA (`QA_REDIRECT_EMAIL`), où tout part vers
      l'adresse du testeur et jamais vers un vrai client.

   2. L'objet : jamais de séparateur orphelin en tête ou en queue
      (« — Payment Received » quand le nom d'entreprise manque). Nettoyé.
      Les autres règles d'objet (≤ 60 caractères, pas d'emoji en tête, pas
      de référence interne) sont journalisées ici et FIGÉES par
      tests/courriels/standards-courriels.test.ts sur chaque modèle.

   3. Le Reply-To : un courriel qui part de l'adresse de la PLATEFORME
      (voix Lume) a toujours `support@…` en Reply-To. Ses textes disent
      « réponds à ce courriel » : sans Reply-To, la réponse partait vers
      une adresse que personne ne lit.

   4. Le nom d'expéditeur : jamais vide. « <factures@lumecrm.net> » tout
      court s'affiche comme une adresse brute dans la boîte de réception.
   ═══════════════════════════════════════════════════════════════ */

/**
 * L'adresse du support — même valeur que `supportEmail` de config.ts, lue ici
 * pour que le mailer n'ait pas à importer config.ts (qui charge Stripe et
 * Twilio au démarrage).
 */
export function adresseSupport(): string {
  return (process.env.SUPPORT_EMAIL || 'support@lumecrm.net').trim();
}

/** Hôtes qu'aucun destinataire ne peut joindre. */
function hoteNonPublic(hote: string): boolean {
  const h = hote.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === '0.0.0.0' || h === '::1' || h === '::') return true;
  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
  }
  return false;
}

/** Les liens (href, src, texte) du courriel qui pointent vers un hôte non public. */
export function liensNonPublics(...contenus: Array<string | null | undefined>): string[] {
  const trouves = new Set<string>();
  for (const c of contenus) {
    if (!c) continue;
    for (const m of c.matchAll(/https?:\/\/(\[[^\]]+\]|[^\s/:"'<>)]+)(?::\d+)?[^\s"'<>)]*/gi)) {
      if (hoteNonPublic(m[1])) trouves.add(m[0]);
    }
  }
  return [...trouves];
}

/** Retire un séparateur orphelin en tête/queue d'objet (« — Paiement reçu », « Facture 12 — »). */
export function nettoyerObjet(objet: string): string {
  return String(objet ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s—–\-·|:]+/, '')
    .replace(/[\s—–\-·|:]+$/, '')
    .trim();
}

const EMOJI_EN_TETE = /^\p{Extended_Pictographic}/u;
/** Référence interne : « #QAV2B-PR-13429 », « #a1b2c3d4 »… (un n° lisible « #42 » reste permis dans le corps). */
const REF_INTERNE = /#[A-Z0-9]{2,}[-_][A-Z0-9-]{2,}|#[0-9a-f]{8,}\b/i;

export const OBJET_MAX = 60;

/** Les écarts d'un objet aux règles permanentes — vide si tout va bien. */
export function ecartsObjet(objet: string): string[] {
  const o = String(objet ?? '');
  const ecarts: string[] = [];
  if (!o.trim()) ecarts.push('objet vide');
  if ([...o].length > OBJET_MAX) ecarts.push(`objet de ${[...o].length} caractères (max ${OBJET_MAX})`);
  if (EMOJI_EN_TETE.test(o.trim())) ecarts.push('emoji en tête d’objet');
  if (REF_INTERNE.test(o)) ecarts.push('référence interne dans l’objet');
  return ecarts;
}

/** « Nom <adresse> » → { nom, adresse }. */
export function decomposerExpediteur(from: string): { nom: string; adresse: string } {
  const m = String(from ?? '').match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { nom: m[1].trim(), adresse: m[2].trim() };
  return { nom: '', adresse: String(from ?? '').trim() };
}

/**
 * L'expéditeur tel qu'il doit partir : jamais sans nom. Un expéditeur de la
 * plateforme sans nom devient « Lume CRM » ; un autre (entreprise sans nom)
 * reçoit `nomDeRepli` — jamais « Lume » dans la voix d'une entreprise.
 */
export function expediteurComplet(from: string, adressePlateforme: string, nomDeRepli = 'Lume CRM'): string {
  const { nom, adresse } = decomposerExpediteur(from);
  if (nom) return from;
  const estPlateforme = adresse.toLowerCase() === adressePlateforme.toLowerCase();
  const nomFinal = estPlateforme ? 'Lume CRM' : nomDeRepli;
  return `${nomFinal.replace(/[<>"]/g, '')} <${adresse}>`;
}

/** Le courriel part-il de l'adresse de la plateforme (voix Lume) ? */
export function estAdressePlateforme(from: string, adressePlateforme: string): boolean {
  return decomposerExpediteur(from).adresse.toLowerCase() === adressePlateforme.toLowerCase();
}
