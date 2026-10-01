/**
 * Robustesse — ce que les familles partagent : la mise en preuve d'un tour, la relecture de l'historique,
 * l'annulation des cartes laissées en attente.
 */
import { extrait, type Proposition } from '../../critiques/jugement.mts';
import { lignesMessages, sqlCompteursDepuis, sqlMessages } from '../faits.mts';
import { codeDe, erreurDe, etatHistorique, type EtatHistorique, type Jugement } from '../jugement.mts';
import type { Contexte, Issue, Preuve, Session, Tour } from '../types.mts';

/** Un tour, tel qu'il part dans le rapport : ce qui a été envoyé, ce qui est revenu. */
export function preuvesDuTour(libelle: string, message: string, t: Tour): Preuve[] {
  const entete = `statut ${t.statut}${t.statut === 200 ? `, étage ${t.etage ?? '—'}` : ''}${t.coupe ? ', COUPÉ par la batterie' : ''}${t.est_flux && !t.termine && !t.coupe ? ', flux sans fin' : ''}, ${t.duree_ms} ms`;
  const corps = t.statut === 200
    ? `${extrait(t.texte, 500)}${t.erreurs.length ? `\n[événement d’erreur : ${t.erreurs.join(', ')}]` : ''}`
    : `${codeDe(t.corps) ? `code ${codeDe(t.corps)} — ` : ''}${erreurDe(t.corps) || extrait(t.corps, 300)}`;
  const evenements = `lectures : ${t.lectures.join(', ') || '—'} ; cartes : ${t.propositions.map((p) => `${p.tool}${p.auto ? ' (d’office)' : ''}`).join(', ') || '—'} ; exécutions : ${t.executes.map((r) => (r.ok ? 'ok' : 'échec')).join(', ') || '—'}`;
  return [
    { libelle: `${libelle} — envoyé`, contenu: extrait(message, 400) },
    { libelle: `${libelle} — reçu (${entete})`, contenu: corps || '(vide)' },
    ...(t.statut === 200 ? [{ libelle: `${libelle} — événements`, contenu: evenements }] : []),
  ];
}

export const cartesEnPreuve = (libelle: string, t: Tour): Preuve => ({
  libelle, contenu: t.propositions.length ? extrait(t.propositions.map((p) => ({ outil: p.tool, d_office: p.auto, args: p.args, apercu: p.apercu })), 1200) : 'aucune',
});

/** La première carte en attente de confirmation d'un tour. */
export const carteEnAttente = (t: Tour, outils?: string[]): Proposition | undefined => t.propositions.find((p) => !p.auto && (!outils || outils.includes(p.tool)));

/** Annule les cartes qu'un tour laisse en attente (aucune écriture) : la batterie ne laisse rien de confirmable derrière elle. */
export async function annulerLesCartes(ctx: Contexte, s: Session, t: Tour): Promise<void> {
  const carte = carteEnAttente(t);
  if (carte && t.conversation_id) await ctx.lumi.annuler(s, t.conversation_id, carte.tool_use_id).catch(() => undefined);
}

/** L'historique enregistré d'une conversation, relu par SELECT et jugé. */
export async function historiqueDe(ctx: Contexte, conversationId: string): Promise<{ etat: EtatHistorique; preuve: Preuve }> {
  const requete = sqlMessages(conversationId);
  const msgs = lignesMessages(await ctx.sql<Record<string, unknown>>(requete));
  const etat = etatHistorique(msgs);
  const plan = msgs.map((m, i) => `${i + 1}. ${m.role} : ${m.genre === 'string' ? `texte (${m.n})` : m.blocs.map((b) => (b.t === 'text' ? `texte (${b.n})` : `${b.t}${b.nom ? ` ${b.nom}` : ''}${b.id ? ` ${String(b.id).slice(-8)}` : ''}`)).join(', ') || '(vide)'}`);
  return { etat, preuve: { libelle: `historique enregistré (SELECT sur lumi_messages, ${msgs.length} messages)`, contenu: `${plan.slice(-40).join('\n')}\n→ ${etat.defauts.length ? `DÉFAUTS : ${etat.defauts.join(' | ')}` : 'valide'}` } };
}

export interface Compteurs { tours: number; conversations: number; ecritures: number }
/**
 * Tours tracés, conversations ouvertes et écritures de Lumi enregistrées pour ce compte depuis un instant.
 * Ces compteurs se lisent PAR DIFFÉRENCE (avant / après) : la fenêtre est élargie de dix minutes, parce que l'horloge
 * de la batterie n'est pas celle de la base — une fenêtre trop courte ne verrait rien et tout passerait.
 */
export async function compteursDepuis(ctx: Contexte, s: Session, depuis: Date): Promise<Compteurs> {
  const [l] = await ctx.sql<Record<string, unknown>>(sqlCompteursDepuis(ctx.org, s.userId, new Date(depuis.getTime() - 600_000).toISOString()));
  return { tours: Number(l?.tours ?? 0), conversations: Number(l?.conversations ?? 0), ecritures: Number(l?.ecritures ?? 0) };
}

export const issue = (j: Jugement, preuves: Preuve[], observations?: string[]): Issue => ({ ...j, preuves, ...(observations?.length ? { observations } : {}) });

export const sansJeu: Issue = { verdict: 'NON COUVERT', constats: ['le jeu [EVAL] est absent du bureau : aucune fiche à viser'], preuves: [] };
