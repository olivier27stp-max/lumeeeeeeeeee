/**
 * Indices d'outils (couverture 100 %, 2026-09-16) — déterministe, 0 token d'API.
 * ─────────────────────────────────────────────────────────────────────────
 * 240 outils dont ~225 différés : le modèle ne les voit qu'en les cherchant
 * avec tool_search_tool_regex, et la batterie a montré qu'à effort bas il
 * répond souvent « je ne peux pas » SANS chercher (pointage, pauses,
 * équipes, étiquettes, taxes…). Ici, le code fait la première recherche :
 * les mots de la demande (français, joual, anglais) sont projetés sur les
 * noms et descriptions des outils, et les meilleurs candidats DIFFÉRÉS sont
 * nommés dans le bloc VARIABLE du prompt avec le motif exact à passer à
 * tool_search_tool_regex. Le bloc stable et le bloc d'outils ne bougent pas :
 * le cache tient. Le modèle reste libre d'ignorer l'indice.
 */
import { AGENT_TOOLS } from '../agent/tools';
import { OUTILS_DE_BASE } from './orchestrateur';
import { normaliser } from './normaliser';

/** Vocabulaire québécois / français → mots anglais des outils. Une clé = un mot normalisé (sans accent). */
const SYNONYMES: Record<string, string[]> = {
  pointe: ['punch', 'timesheet'], pointer: ['punch', 'timesheet'], poincon: ['punch'], poinconne: ['punch'], punch: ['punch'],
  pause: ['break', 'toggle', 'pause'], break: ['break'], commence: ['punch', 'start'], fini: ['punch', 'end'], journee: ['punch'],
  heures: ['timesheet', 'hours'], temps: ['timesheet'], approuve: ['approve'], paie: ['payroll'], salaire: ['payroll', 'hourly'], taux: ['hourly', 'rate', 'tax'], horaire: ['hourly', 'schedule'], bonus: ['payroll', 'adjustment'],
  equipe: ['team', 'member'], equipes: ['team'], crew: ['team'], gang: ['team'], membre: ['member'], employe: ['member'], technicien: ['member'], techniciens: ['member'], permets: ['permission', 'role', 'preset'], permet: ['permission', 'role', 'preset'], autorise: ['permission', 'role', 'preset'], interdis: ['permission', 'role', 'preset'], acces: ['permission'], droit: ['permission'], droits: ['permission'], donne: ['set', 'grant'], financiers: ['finance'], financieres: ['finance'], invite: ['invite', 'invitation'], invitation: ['invitation'], role: ['role', 'permission'], permission: ['permission'], permissions: ['permission'], suspend: ['member', 'remove'], suspends: ['member', 'remove'], reactive: ['reactivate'],
  prospect: ['lead'], prospects: ['lead'], lead: ['lead'], pipeline: ['deal', 'lead'], carte: ['deal', 'card'], cartes: ['deal', 'card'], vente: ['deal'], ventes: ['deal'], gagne: ['deal', 'won'], perdu: ['deal', 'lost'], etape: ['stage', 'status'], demande: ['request', 'submission'], demandes: ['request', 'submission'], formulaire: ['request', 'submission'],
  adresse: ['property', 'address'], adresses: ['property'], propriete: ['property'], chalet: ['property'], note: ['note'], notes: ['note'], champ: ['custom_field', 'field'], champs: ['custom_field'], personnalise: ['custom_field'],
  soumission: ['quote'], soumissions: ['quote'], devis: ['quote'], estime: ['quote'], prereglage: ['preset'], prereglages: ['preset'], modele: ['template'], modeles: ['template'], duplique: ['duplicate'], dupliquer: ['duplicate'], copie: ['duplicate'],
  facture: ['invoice'], factures: ['invoice'], brouillon: ['draft'], annule: ['void', 'cancel', 'revoke'], annuler: ['void', 'cancel', 'revoke'], archive: ['archive', 'unarchive'], archivee: ['archive', 'unarchive'], sors: ['unarchive'], desarchive: ['unarchive'], rembourse: ['refund'], remboursement: ['refund'], paiement: ['payment'], paiements: ['payment'], partiel: ['payment', 'partial'], comptant: ['payment'], recurrente: ['recurring'], recurrent: ['recurring', 'recurrence'], recurrentes: ['recurring'], recurrence: ['recurrence'], recurrents: ['recurring', 'recurrence'], lien: ['payment_request', 'link'], relance: ['reminder', 'automation'], relances: ['reminder', 'automation'], rappel: ['reminder', 'automation'], message: ['message'], carte_enregistree: ['card'], enregistree: ['card', 'card_on_file'],
  job: ['job'], jobs: ['job'], travail: ['job'], chantier: ['job'], calendrier: ['schedule', 'unschedule'], deplanifie: ['unschedule'], visite: ['visit'], jalon: ['milestone'], jalons: ['milestone'], depot: ['milestone', 'deposit'], contrat: ['agreement'], contrats: ['agreement'], signature: ['agreement', 'sign'], signe: ['agreement'],
  liste: ['checklist', 'list'], verification: ['checklist'], verifier: ['checklist'], verifie: ['checklist'], checklist: ['checklist'], coche: ['checklist'], etiquette: ['tag'], etiquettes: ['tag'], tag: ['tag'], tags: ['tag'], disponibilite: ['availability'], disponibilites: ['availability'], plage: ['availability'], principale: ['default'], principal: ['default'], defaut: ['default'], remets: ['update', 'set', 'revert'],
  tache: ['task'], taches: ['task'], termine: ['status', 'done'], terminees: ['status', 'done'],
  texto: ['sms', 'conversation'], textos: ['sms'], sms: ['sms'], conversation: ['conversation'], lue: ['read', 'conversation'], courriel: ['email'], courriels: ['email'], email: ['email'],
  automatisation: ['automation'], automatisations: ['automation'], regle: ['automation', 'rule'], langue: ['language'], anglais: ['language'],
  taxe: ['tax'], taxes: ['tax'], tps: ['tax'], tvq: ['tax'], configurees: ['config'], configure: ['config', 'setup'], configuration: ['config'], catalogue: ['service'], service: ['service'], services: ['service'], objectif: ['goal'], objectifs: ['goal'], rapport: ['report'], rapports: ['report'], automatique: ['scheduled', 'automation'], notification: ['notification'], notifications: ['notification'], cloche: ['notification'],
  maison: ['house'], maisons: ['house'], cogne: ['house', 'event'], cognees: ['house'], porte: ['house', 'field'], territoire: ['territory'], restriction: ['settings', 'd2d'], reglage: ['settings'], reglages: ['settings'], parametre: ['settings'], parametres: ['settings'], territoires: ['territory'], representant: ['rep'], representants: ['rep'], terrain: ['field'], session: ['field_session', 'session'], badge: ['badge'], defi: ['challenge'], bataille: ['battle'], batailles: ['battle'], organise: ['create'], lance: ['create', 'start'],
  formation: ['course'], formations: ['course'], cours: ['course'], module: ['module'], lecon: ['lesson'], lecons: ['lesson'], publie: ['publish'], assigne: ['assign'],
  montre: ['list'], montrer: ['list'], quels: ['list'], quelles: ['list'], quoi: ['list'], voir: ['list'], show: ['list'], clock: ['punch'], clocked: ['punch'],
  supprime: ['delete'], supprimer: ['delete'], efface: ['delete'], enleve: ['delete', 'remove'], retire: ['delete', 'remove'], cree: ['create'], creer: ['create'], ajoute: ['create', 'add'], change: ['update'], monte: ['update'], baisse: ['update'], augmente: ['update'], prix: ['price'], modifie: ['update'], renomme: ['update', 'rename', 'name'], description: ['update', 'description'], corrige: ['update'], mets: ['update', 'set'], passe: ['update', 'set'], arrete: ['deactivate', 'delete'], active: ['toggle', 'enable'], desactive: ['toggle'], envoie: ['send'], renvoie: ['resend'], texte: ['sms', 'message'],
};

const VERBES_GENERIQUES: ReadonlySet<string> = new Set(['list', 'get', 'create', 'update', 'delete', 'set', 'add', 'remove', 'send', 'resend', 'run', 'mark', 'save', 'log', 'start', 'end']);

interface Indice { nom: string; nomMots: Set<string>; mots: Set<string> }
/** Mots du nom d'un outil, au singulier ET au pluriel (list_deals doit répondre à « deal »). */
function motsDuNom(nom: string): Set<string> {
  const out = new Set<string>();
  for (const m of nom.split('_')) {
    out.add(m);
    if (m.length > 4 && m.endsWith('ies')) out.add(m.slice(0, -3) + 'y');
    else if (m.length > 3 && m.endsWith('s')) out.add(m.slice(0, -1));
  }
  return out;
}
let INDEX: Indice[] | null = null;
function index(): Indice[] {
  if (INDEX) return INDEX;
  INDEX = AGENT_TOOLS
    .filter((t) => !OUTILS_DE_BASE.has(t.declaration.name))
    .map((t) => ({
      nom: t.declaration.name,
      nomMots: motsDuNom(t.declaration.name),
      mots: new Set(normaliser(`${t.declaration.name.replace(/_/g, ' ')} ${t.declaration.description}`).filter((m) => m.length > 2)),
    }));
  return INDEX;
}

/** Les mots anglais à chercher pour une demande (mots de l'énoncé + synonymes), sans doublon. */
export function motsCles(enonce: string): string[] {
  const out = new Set<string>();
  for (const m of normaliser(enonce)) {
    if (m.length > 2) out.add(m);
    for (const s of SYNONYMES[m] ?? []) out.add(s);
  }
  return [...out];
}

/** Les outils différés qui ressemblent le plus à la demande (nom d'outil ×3, verbe générique ×2, description ×1), au plus `limite`. Pur, testé. */
export function outilsSuggeres(enonce: string, limite = 6, outils: Indice[] = index()): string[] {
  const cles = motsCles(enonce);
  if (!cles.length) return [];
  const scores = outils.map((o) => {
    let s = 0;
    for (const c of cles) {
      // Un nom de domaine dans le nom de l'outil (tax, punch, deal…) pèse 3 ; un verbe générique (list, create…) 2.
      if (o.nomMots.has(c)) s += VERBES_GENERIQUES.has(c) ? 2 : 3;
      else if (o.mots.has(c)) s += 1;
    }
    return { nom: o.nom, s };
  }).filter((x) => x.s >= 3).sort((a, b) => b.s - a.s || a.nom.localeCompare(b.nom));
  return scores.slice(0, limite).map((x) => x.nom);
}

/** Ligne du bloc VARIABLE : les candidats et le motif exact pour tool_search_tool_regex. Vide s'il n'y a rien à suggérer. */
export function indiceOutils(enonce: string, langue: 'fr' | 'en'): string | null {
  const noms = outilsSuggeres(enonce);
  if (!noms.length) return null;
  const motif = `^(${noms.join('|')})$`;
  return langue === 'fr'
    ? `Outils différés qui semblent correspondre à cette demande (charge-les d'abord avec tool_search_tool_regex, motif \`${motif}\`, puis agis ; ne dis jamais « je n'ai pas d'outil » avant d'avoir essayé) : ${noms.join(', ')}.`
    : `Deferred tools that seem to match this request (load them first with tool_search_tool_regex, pattern \`${motif}\`, then act; never say "I have no tool" before trying): ${noms.join(', ')}.`;
}
