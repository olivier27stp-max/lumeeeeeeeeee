/**
 * Le « oui » par texto (audit des outils de Lumi, 2026-09-30).
 * ─────────────────────────────────────────────────────────────
 * Sur l'app, une carte se confirme par un clic sur UNE proposition. Par
 * texto, la confirmation est le message suivant, et trois trous existaient :
 *   · aucune expiration : un « oui » envoyé le lendemain (ou pour autre
 *     chose) exécutait la proposition de la veille ;
 *   · rien ne liait la proposition au membre qui l'a reçue ;
 *   · deux « oui » rapprochés pouvaient exécuter deux fois.
 *
 * Ici : la proposition expire après EXPIRATION_CONFIRMATION_MIN, doit
 * appartenir au membre et à l'entreprise qui répondent, et se CONSOMME par
 * une écriture conditionnelle (le marqueur est retiré du message ; un second
 * « oui » simultané ne trouve plus rien à consommer).
 */
import type { PropositionSms } from './lumi-sms';

export const EXPIRATION_CONFIRMATION_MIN = 15;

export type VerdictProposition =
  | { ok: true }
  | { ok: false; raison: 'expiree' | 'autre_membre' };

/** Pur : la proposition relue peut-elle encore être confirmée par ce membre ? */
export function verifierProposition(
  p: PropositionSms,
  creeLe: string | null | undefined,
  membre: { userId: string; orgId: string },
  maintenant: number = Date.now(),
): VerdictProposition {
  if (!p.user_id || p.user_id !== membre.userId || (p.org_id && p.org_id !== membre.orgId)) {
    return { ok: false, raison: 'autre_membre' };
  }
  const t = creeLe ? Date.parse(creeLe) : NaN;
  if (!Number.isFinite(t) || maintenant - t > EXPIRATION_CONFIRMATION_MIN * 60_000) return { ok: false, raison: 'expiree' };
  return { ok: true };
}

/** Les écritures à exécuter, dans l'ordre de la carte. */
export function ecrituresDe(p: PropositionSms): Array<{ tool: string; args: Record<string, unknown>; tool_use_id: string }> {
  return p.groupe && p.groupe.length ? p.groupe : [{ tool: p.tool, args: p.args, tool_use_id: p.tool_use_id }];
}
