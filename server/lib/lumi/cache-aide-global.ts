/**
 * Une réponse d'aide de Lumi peut-elle être servie à TOUTES les entreprises ?
 * ──────────────────────────────────────────────────────────────────────────
 * Le cache d'aide « global » rend à n'importe quelle entreprise la réponse
 * donnée une fois à une autre (« comment je fais X dans Lume »). Inventaire S6,
 * 2026-10-01 : côté Lumi, la seule condition était « seul search_help a servi,
 * et le texte ne contient ni le nom complet de l'entreprise ni celui de la
 * personne ». Or le modèle de Lumi a sous les yeux bien plus que la doc : les
 * fiches repérées dans la demande (noms de clients, montants), les notes de
 * mémoire de l'entreprise, son prénom. Une réponse qui en reprend un mot
 * serait partie chez un autre client.
 *
 * Même règle prudente que le support (`reponseGenerique`) — aucun chiffre,
 * aucune phrase d'état, aucun morceau du nom — plus ce qui est propre à Lumi :
 * rien si des fiches du compte ont été données au modèle, rien si la réponse
 * tutoie un état (« tu as », « ton compte »), rien si elle reprend un nom
 * propre d'une note de mémoire. Dans le doute : non. La réponse reste alors
 * mémorisée pour l'entreprise seulement, comme avant.
 *
 * Tests : tests/lumi-cache-aide-global.test.ts
 */
import { reponseGenerique } from '../support/garde-fous';

const ETAT_TUTOYE = /\b(tu as|tu es|t['’]as|t['’]es|ton compte|ta compagnie|ton entreprise|ton forfait|chez toi|dans ton cas)\b/i;

export interface CandidatAideGlobale {
  texte: string;
  outils: string[];
  companyName?: string | null;
  userName?: string | null;
  /** Notes de mémoire de l'entreprise présentes dans le prompt. */
  souvenirs?: ReadonlyArray<{ key?: string; value: string }> | null;
  /** Bloc de repérage donné au modèle (fiches du compte citées dans la demande) ; null s'il n'y en avait pas. */
  reperage?: string | null;
}

export function reponseAidePartageable(c: CandidatAideGlobale): boolean {
  if (c.reperage && c.reperage.trim()) return false;
  if (!reponseGenerique(c.texte, c.outils, { userName: c.userName, companyName: c.companyName })) return false;
  if (ETAT_TUTOYE.test(c.texte)) return false;
  const t = c.texte.toLowerCase();
  for (const s of c.souvenirs ?? []) {
    for (const mot of `${s.key ?? ''} ${s.value}`.split(/[^\p{L}\p{N}]+/u)) {
      if (mot.length >= 4 && /^\p{Lu}/u.test(mot) && t.includes(mot.toLowerCase())) return false;
    }
  }
  return true;
}
