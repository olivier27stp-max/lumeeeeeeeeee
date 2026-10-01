/**
 * Batterie de l'agent de support — un TOUR et sa preuve.
 * `poser` pose la question à POST /api/support/chat, puis relit par SELECT ce que le serveur a
 * écrit : le ticket, ses messages système, la trace (étage, outils) et le grand livre (modèle, coût).
 * Deux arrêts immédiats : un fil Slack sur le ticket (envoi réel à l'équipe), l'outil de migration
 * de données appelé par le modèle (il prévient les administrateurs réels).
 */
import { ArretImmediat } from './acces.mts';
import { sqlMessages, sqlTicket, sqlTrace, sqlUsageSupport } from './faits.mts';
import { enonceNormalise, envoiSlack, extrait, ticketEnClair, type Jugement } from './jugement.mts';
import type { ClientSupport, Issue, Observation, Preuve, Session, TicketLu, Tour } from './types.mts';

type Sql = <T = Record<string, unknown>>(requete: string) => Promise<T[]>;

export function creerPoser(o: { org: string; sql: Sql; support: ClientSupport; attendre: (ms: number) => Promise<void>; tours: Tour[]; surTicket: (s: Session, ticketId: string) => void }) {
  return async function poser(s: Session, test: string, question: string, opts: { humain?: boolean; ticketId?: string } = {}): Promise<Observation> {
    const r = await o.support.demander(s, question, opts);
    const obs: Observation = {
      statut: r.statut, question, reponse: r.reponse ?? '', escalade_api: r.escalade, ticket: null, systeme: [], etage: null, action: null, outils: [],
      modele: null, cout_cents: null, appels_modele: 0, corps: r.corps, duree_ms: r.duree_ms, debut: r.debut, fin: r.fin,
    };
    if (r.ticket_id) {
      o.surTicket(s, r.ticket_id);
      // Les écritures de fin de tour (trace, grand livre) partent après la réponse : on leur laisse le temps.
      await o.attendre(1500);
      const [ticket] = await o.sql<TicketLu>(sqlTicket(o.org, r.ticket_id));
      obs.ticket = ticket ?? null;
      obs.systeme = (await o.sql<{ author: string; body: string }>(sqlMessages(r.ticket_id))).filter((m) => m.author === 'system').map((m) => String(m.body));
      if (!opts.humain) {
        const lireTrace = async (): Promise<boolean> => {
          const [t] = await o.sql<{ etage: number | null; action: string | null; outils: string[] | null }>(sqlTrace(o.org, s.userId, enonceNormalise(question), r.debut));
          if (!t) return false;
          obs.etage = t.etage === null ? null : Number(t.etage);
          obs.action = t.action;
          obs.outils = Array.isArray(t.outils) ? t.outils.map(String) : [];
          return true;
        };
        if (!(await lireTrace())) { await o.attendre(2500); await lireTrace(); }
        const usage = await o.sql<{ model: string; cost_cents: number }>(sqlUsageSupport(o.org, [s.userId], r.debut, r.fin));
        obs.appels_modele = usage.length;
        if (usage.length) {
          obs.cout_cents = usage.reduce((n, l) => n + Number(l.cost_cents), 0);
          obs.modele = [...new Set(usage.map((l) => String(l.model)))].join(', ');
        }
      }
    }
    o.tours.push({
      test, compte: s.cle, user_id: s.userId, question, ticket_id: r.ticket_id, statut: r.statut, etage: obs.etage, action: obs.action, outils: obs.outils,
      modele: obs.modele, appels_modele: obs.appels_modele, cout_cents: obs.cout_cents, duree_ms: r.duree_ms, debut: r.debut, fin: r.fin,
    });
    // Le canari juge lui-même un envoi Slack (il doit rendre son verdict) ; partout ailleurs, c'est l'arrêt.
    if (!opts.humain && envoiSlack(obs)) throw new ArretImmediat(`ENVOI RÉEL À L’ÉQUIPE pendant « ${test} » : ${ticketEnClair(obs.ticket)} ; messages système : ${obs.systeme.join(', ')}. La batterie s’arrête.`);
    if (obs.outils.includes('start_migration')) throw new ArretImmediat(`L’outil de migration de données (start_migration) a été appelé pendant « ${test} » : il prévient les administrateurs réels de la plateforme. La batterie s’arrête ; annuler la migration créée dans le bureau de test.`);
    return obs;
  };
}

/** Ce que le rapport montre d'un tour : la question, la réponse, l'étage, le ticket, les lignes lues. */
export function preuvesDuTour(o: Observation, plus: Preuve[] = []): Preuve[] {
  const etage = o.etage === null ? 'étage non lu' : `étage ${o.etage}${o.action ? ` — ${o.action}` : ''}`;
  const modele = o.appels_modele ? `${o.modele ?? 'modèle non lu'}, ${o.appels_modele} appel(s), ${(o.cout_cents ?? 0).toFixed(3)} ¢` : 'aucun appel au modèle dans le grand livre';
  return [
    { libelle: 'question', contenu: o.question },
    { libelle: `réponse (statut ${o.statut}, ${etage}, outils : ${o.outils.join(', ') || '—'} ; ${modele} ; ${o.duree_ms} ms)`, contenu: o.statut === 200 ? extrait(o.reponse || '(aucun texte : transfert direct)', 1500) : extrait(o.corps, 600) },
    { libelle: 'ticket (SELECT support_tickets et support_messages)', contenu: `${ticketEnClair(o.ticket)}\nmessages système : ${o.systeme.join(', ') || 'aucun'} ; champ « escalated » de l’API : ${o.escalade_api}` },
    ...plus,
  ];
}

export const issue = (j: Jugement, preuves: Preuve[]): Issue => ({ ...j, preuves });

/** Un test d'un seul tour : poser, juger, joindre la preuve. */
export async function unTour(poser: (s: Session, test: string, question: string) => Promise<Observation>, s: Session, test: string, question: string, juger: (o: Observation) => Jugement): Promise<Issue> {
  const o = await poser(s, test, question);
  return issue(juger(o), preuvesDuTour(o));
}
