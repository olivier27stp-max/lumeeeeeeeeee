/**
 * La batterie de robustesse de Lumi (scripts/qa/lumi/robustesse) rend un verdict au propriétaire du produit : ses
 * JUGES doivent être justes avant de juger Lumi. Chaque juge est éprouvé avec le défaut présent — un test qui ne
 * peut pas échouer ne vaut rien. Hors réseau : ni base, ni production, ni modèle (un serveur local de 127.0.0.1
 * éprouve la coupure du flux).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { echangeVide, estLectureSeule, type Proposition } from '../scripts/qa/lumi/critiques/jugement.mts';
import {
  BORNE_COUT, classerDecision, classerTour, ecrituresEnAttente, estOccupee, estPlafondConversation, etatDuRappel, etatHistorique, evenementComplet, gardeConfirmation,
  issueInterruption, jugerCarteCible, jugerCoutBorne, jugerDemandePrecision, jugerDeuxMessages, jugerLectureCible, jugerLimiteHoraire, jugerMessageEtConfirmer, jugerParalleles,
  jugerRecuEchec, jugerRefusPropre, jugerReponseCoupee, jugerReprise, jugerRevirement, jugerSansAction, jugerServi, jugerSilence, jugerStopReasons, jugerSuiteApresEchec,
  jugerUneSeuleFois, marqueursDeLaCible, mediane, messagesVides, ordreDesMentions, serveurRedemarre, sortsDesCartes, wavSilence,
  type Cible, type EtatHistorique, type LigneStop, type MessageHistorique, type ReponseDecision, type TourMesure,
} from '../scripts/qa/lumi/robustesse/jugement.mts';
import { BUREAUX, ORG_DEFAUT, bureauDe, chargerFaits, toutesLesRequetes } from '../scripts/qa/lumi/robustesse/faits.mts';
import { ConfirmationRefusee, FluxInterrompu, LIMITE_HORAIRE as LIMITE_DU_CLIENT, LimiteAtteinte, attenteAnnoncee, creerClientLumi } from '../scripts/qa/lumi/robustesse/acces.mts';
import { BUDGET_CENTS, LIMITE_HORAIRE, appelsPrevus, bilanDe, coutDuChoix, couverture, fusionner, rapportMarkdown, selectionner, textePlan, type Passe } from '../scripts/qa/lumi/robustesse/rapport.mts';
import { FAMILLES } from '../scripts/qa/lumi/robustesse/run.mts';
import { RACCOURCIS, RAPPELS_A, RAPPEL_B, TOURS, scriptLongue } from '../scripts/qa/lumi/robustesse/familles/longue.mts';
import { COLLAGE, LIMITE_MESSAGE, MESSAGE_LONG, MESSAGE_TROP_LONG } from '../scripts/qa/lumi/robustesse/familles/entrees.mts';
import { HORS_RESEAU } from '../scripts/qa/lumi/robustesse/familles/pannes.mts';
import { demandeDeCarteParLeModele } from '../scripts/qa/lumi/robustesse/familles/reprise.mts';
import { titreRob } from '../scripts/qa/lumi/robustesse/fiches-rob.mts';
import {
  COMPTES, LIGNES_PHASE4, MARQUEUR_ROB,
  type CarteRendue, type ClientLumi, type Contexte, type ConversationRendue, type GardeDeConfirmation, type Issue, type MessageRendu, type OptionsTour, type Resultat, type Sante, type Session, type Tour,
} from '../scripts/qa/lumi/robustesse/types.mts';
import { idEval } from '../scripts/qa/lumi/jeu-eval.mts';
import { detecterRaccourci } from '../server/lib/lumi/raccourcis';
import { detecterActionDirecte } from '../server/lib/lumi/actions-directes';
import { estDemandeDAction } from '../server/lib/lumi/demande-action';

const RACINE = join(__dirname, '..');
const ROB = join(RACINE, 'scripts', 'qa', 'lumi', 'robustesse');
const ev = (type: string, data: unknown): string => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
/** Un tour servi, fini, sans erreur — à partir duquel chaque test fabrique son défaut. */
const tour = (t: Partial<Tour> = {}): Tour => ({ ...echangeVide(200), texte: 'Voilà.', coupe: false, termine: true, restant: null, retry_after: null, est_flux: true, etage: 6, ...t });
const refus = (statut: number, corps: unknown, t: Partial<Tour> = {}): Tour => tour({ statut, corps, texte: '', termine: false, est_flux: false, etage: null, ...t });
const carte = (p: Partial<Proposition>): Proposition => ({ tool_use_id: 'toolu_1', tool: 'send_sms', args: {}, apercu: null, auto: false, ...p });
const BERGERON: Cible = { libelle: 'Luc Bergeron', telephones: ['514-555-0114'], courriels: ['depanneur.bergeron@lume-qa.test'] };
const GIRARD: Cible = { libelle: 'Patrick Girard', telephones: ['514-555-0116'], courriels: ['patrick.girard@lume-qa.test'] };
const VALIDE: EtatHistorique = { defauts: [], en_attente: [], resultats: {}, messages: 6 };
const CASSE: EtatHistorique = { ...VALIDE, defauts: ['action « list_invoices » (toolu_9) sans résultat dans le tour suivant : l’API du modèle refuse cet historique'] };
const OCCUPEE = { error: 'Lumi répond déjà dans cette conversation. Attends la fin de sa réponse, puis renvoie ton message.', code: 'conversation_occupee' };

describe('le flux, pendant qu’il arrive', () => {
  it('ne voit un événement que lorsqu’il est arrivé en entier', () => {
    expect(evenementComplet('event: text\ndata: {"delta":"Bon', 'text')).toBe(false);
    expect(evenementComplet(`${ev('tool', { name: 'list_invoices', statut: 'debut' })}event: text\ndata: {"delta":"Bon"}`, 'text')).toBe(false);
    expect(evenementComplet(ev('tool', { name: 'x', statut: 'fin' }) + ev('text', { delta: 'Bonjour' }), 'text')).toBe(true);
    expect(evenementComplet(ev('text', { delta: 'Je te propose' }), 'proposal')).toBe(false);
    expect(evenementComplet(ev('text', { delta: 'ok' }) + ev('proposal', { tool: 'create_task' }), 'proposal')).toBe(true);
  });
  it('classe un tour : répondu, refusé proprement par le verrou, ou en défaut', () => {
    expect(classerTour(tour()).genre).toBe('repondu');
    expect(classerTour(tour({ texte: '', propositions: [carte({})] })).genre).toBe('repondu');
    expect(classerTour(refus(409, OCCUPEE)).genre).toBe('occupee');
    expect(estOccupee(refus(409, { code: 'decision_en_cours', error: 'Cette action est déjà en cours de traitement.' }))).toBe(true);
    expect(estOccupee(refus(409, { code: 'aucune_proposition' }))).toBe(false);
    // Les défauts : un verrou muet, une erreur du serveur, un flux sans fin, un événement d'erreur, une réponse vide.
    expect(classerTour(refus(409, { code: 'conversation_occupee' })).genre).toBe('defaut');
    expect(classerTour(refus(500, { error: 'Lumi failed to respond.' })).genre).toBe('defaut');
    expect(classerTour(tour({ termine: false })).genre).toBe('defaut');
    expect(classerTour(tour({ erreurs: ['Lumi failed to respond.'] })).genre).toBe('defaut');
    expect(classerTour(tour({ texte: '  ' })).genre).toBe('defaut');
  });
});

describe('2. références implicites — la bonne fiche', () => {
  it('reconnaît les marqueurs d’une cible, quelle que soit la ponctuation', () => {
    expect(marqueursDeLaCible('Son numéro : (514) 555-0114.', BERGERON)).toHaveLength(1);
    expect(marqueursDeLaCible('Écris à Depanneur.Bergeron@lume-qa.test', BERGERON)).toHaveLength(1);
    expect(marqueursDeLaCible('Il doit 229,95 $.', { libelle: 'x', montants_cents: [22995] })).toHaveLength(1);
    expect(marqueursDeLaCible('Son numéro : 514-555-0116.', BERGERON)).toEqual([]);
  });
  it('lit l’ordre de la liste que LUMI a rendue', () => {
    const candidats = [{ cle: 'bergeron', marqueurs: ['Bergeron'] }, { cle: 'girard', marqueurs: ['Girard'] }, { cle: 'cote', marqueurs: ['Côté'] }];
    expect(ordreDesMentions('1. Patrick Girard — 919,80 $\n2. Luc Bergeron — 229,95 $', candidats)).toEqual(['girard', 'bergeron']);
    expect(ordreDesMentions('Tu as 2 factures en retard.', candidats)).toEqual([]);
  });
  it('lecture : PASS sur la bonne fiche, FAIL sur l’autre, A RELIRE si les deux, FAIL si la référence n’est pas résolue', () => {
    const o = { attendu: GIRARD, exclus: [BERGERON] };
    expect(jugerLectureCible(tour({ texte: 'Patrick Girard : 514-555-0116.' }), o).verdict).toBe('PASS');
    expect(jugerLectureCible(tour({ texte: 'Luc Bergeron : 514-555-0114.' }), o).verdict).toBe('FAIL');
    expect(jugerLectureCible(tour({ texte: 'Bergeron : 514-555-0114 ; Girard : 514-555-0116.' }), o).verdict).toBe('A RELIRE');
    const flou = jugerLectureCible(tour({ texte: 'De quel client parles-tu ?' }), o);
    expect(flou.verdict).toBe('FAIL');
    expect(flou.constats.join(' ')).toContain('non résolue');
    expect(jugerLectureCible(tour({ texte: 'Patrick Girard : 514-555-0116.', propositions: [carte({})] }), o).verdict).toBe('FAIL');
    expect(jugerLectureCible(refus(500, null), o).verdict).toBe('NON COUVERT');
  });
  it('carte : PASS sur la bonne cible, FAIL sur la mauvaise, sans carte, exécutée, ou d’office', () => {
    const o = { outils: ['send_sms'], attendu: GIRARD, exclus: [BERGERON] };
    const bonne = carte({ args: { client_id: 'x', body: 'Bonjour' }, apercu: { to: 'Patrick Girard · 514-555-0116' } });
    expect(jugerCarteCible(tour({ texte: 'Je te propose ce texto.', propositions: [bonne] }), o).verdict).toBe('PASS');
    const mauvaise = jugerCarteCible(tour({ propositions: [carte({ apercu: { to: 'Luc Bergeron · 514-555-0114' } })] }), o);
    expect(mauvaise.verdict).toBe('FAIL');
    expect(mauvaise.constats.join(' ')).toContain('MAUVAISE cible');
    expect(jugerCarteCible(tour({ texte: 'À qui veux-tu l’envoyer ?' }), o).verdict).toBe('FAIL');
    expect(jugerCarteCible(tour({ propositions: [carte({ tool: 'send_email', apercu: { to: '514-555-0116' } })] }), o).verdict).toBe('FAIL');
    expect(jugerCarteCible(tour({ propositions: [bonne], executes: [{ tool_use_id: 'toolu_1', ok: true, auto: false, fiche: null }] }), o).verdict).toBe('FAIL');
    expect(jugerCarteCible(tour({ propositions: [{ ...bonne, auto: true }] }), o).verdict).toBe('FAIL');
    expect(jugerCarteCible(tour({ texte: 'C’est fait, le texto est parti.', propositions: [bonne] }), o).verdict).toBe('FAIL');
  });
});

describe('7. vocal — une dictée douteuse ne donne jamais une action devinée', () => {
  const o = { outils: ['send_sms'], attendu: GIRARD, exclus: [BERGERON], question_acceptee: true };
  it('nom déformé : une question vaut, une carte exacte vaut, une carte sur un autre client échoue', () => {
    expect(jugerCarteCible(tour({ texte: 'Tu veux dire Patrick Girard ?' }), o).verdict).toBe('PASS');
    expect(jugerCarteCible(tour({ texte: 'Je ne trouve aucun client nommé Patrick Gérard.' }), o).verdict).toBe('PASS');
    expect(jugerCarteCible(tour({ propositions: [carte({ apercu: { to: 'Patrick Girard · 514-555-0116' } })] }), o).verdict).toBe('PASS');
    expect(jugerCarteCible(tour({ propositions: [carte({ apercu: { to: 'Luc Bergeron · 514-555-0114' } })] }), o).verdict).toBe('FAIL');
    expect(jugerCarteCible(tour({ texte: 'Bien reçu.' }), o).verdict).toBe('A RELIRE');
  });
  it('phrase coupée, montant ambigu : une question, jamais une carte', () => {
    expect(jugerDemandePrecision(tour({ texte: 'Quelle facture, et à quel client ?' })).verdict).toBe('PASS');
    const devine = jugerDemandePrecision(tour({ texte: 'Voici la facture.', propositions: [carte({ tool: 'create_invoice', args: { amount_cents: 15000 } })] }));
    expect(devine.verdict).toBe('FAIL');
    expect(devine.constats.join(' ')).toContain('devinée');
    expect(jugerDemandePrecision(tour({ texte: 'Je m’en occupe.' })).verdict).toBe('A RELIRE');
    expect(jugerDemandePrecision(tour({ texte: '' })).verdict).toBe('FAIL');
  });
  it('bruit : une réponse, sans carte ni exécution ni erreur', () => {
    expect(jugerSansAction(tour({ texte: 'Je n’ai pas compris, tu peux répéter ?' })).verdict).toBe('PASS');
    expect(jugerSansAction(tour({ propositions: [carte({})] })).verdict).toBe('FAIL');
    expect(jugerSansAction(tour({ erreurs: ['Lumi failed to respond.'] })).verdict).toBe('FAIL');
    expect(jugerSansAction(tour({ texte: '' })).verdict).toBe('FAIL');
    expect(jugerSansAction(refus(500, null)).verdict).toBe('FAIL');
  });
  it('fabrique un WAV muet valide, et juge la dictée d’un silence', () => {
    const w = wavSilence(1);
    expect(w.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(w.subarray(8, 12).toString('ascii')).toBe('WAVE');
    expect(w.length).toBe(44 + 32_000);
    expect(w.readUInt32LE(40)).toBe(32_000);
    expect(w.subarray(44).every((o8) => o8 === 0)).toBe(true);
    // Le schéma du serveur : au moins 100 caractères en base64, au plus 5,6 Mo.
    expect(w.toString('base64').length).toBeGreaterThan(100);
    expect(w.toString('base64').length).toBeLessThan(5_600_000);
    expect(jugerSilence({ statut: 200, json: { text: '  ' } }).verdict).toBe('PASS');
    const invente = jugerSilence({ statut: 200, json: { text: 'Merci d’avoir regardé cette vidéo.' } });
    expect(invente.verdict).toBe('FAIL');
    expect(invente.constats[0]).toContain('INVENTE');
    expect(jugerSilence({ statut: 500, json: { error: 'Transcription failed.' } }).verdict).toBe('FAIL');
    expect(jugerSilence({ statut: 429, json: { code: 'plafond_jour' } }).verdict).toBe('NON COUVERT');
    expect(jugerSilence({ statut: 200, json: {} }).verdict).toBe('FAIL');
  });
});

describe('l’historique enregistré : ce que l’API du modèle accepte', () => {
  const u = (texte: string): MessageHistorique => ({ role: 'user', genre: 'string', n: texte.length, blocs: [] });
  const a = (...blocs: MessageHistorique['blocs']): MessageHistorique => ({ role: 'assistant', genre: 'array', n: null, blocs });
  const r = (...ids: string[]): MessageHistorique => ({ role: 'user', genre: 'array', n: null, blocs: ids.map((id) => ({ t: 'tool_result', id })) });
  const texte = { t: 'text', n: 20 };
  const outil = (id: string, nom = 'list_invoices'): MessageHistorique['blocs'][number] => ({ t: 'tool_use', id, nom });
  it('valide : une lecture et son résultat, une carte annulée par le message suivant, une carte encore en attente', () => {
    const h = etatHistorique([
      u('factures en retard ?'), a(outil('t1')), r('t1'), a(texte),
      u('crée une tâche'), a(outil('t2'), outil('w1', 'create_task')), r('t2'), r('w1'), u('non, laisse faire'), a(texte),
      u('crée-la quand même'), a(texte, outil('w2', 'create_task')),
    ]);
    expect(h.defauts).toEqual([]);
    expect(h.en_attente).toEqual(['w2']);
    expect(h.resultats).toEqual({ t1: 1, t2: 1, w1: 1 });
  });
  it('défaut : une action sans son résultat (deux tours écrits l’un dans l’autre)', () => {
    const h = etatHistorique([u('a'), a(outil('t1')), u('b'), a(texte), r('t1'), a(texte)]);
    expect(h.defauts.join(' | ')).toContain('sans résultat dans le tour suivant');
    expect(h.defauts.join(' | ')).toContain('sans action dans le tour de Lumi qui précède');
  });
  it('défaut : deux résultats pour la même carte (confirmée et annulée à la fois)', () => {
    const h = etatHistorique([u('crée une tâche'), a(outil('w1', 'create_task')), r('w1'), r('w1'), a(texte)]);
    expect(h.defauts.join(' | ')).toContain('2 résultats enregistrés pour la même action');
  });
  it('défaut : le résultat arrive après le message suivant de l’utilisateur', () => {
    const h = etatHistorique([u('crée une tâche'), a(outil('w1', 'create_task')), u('autre chose'), r('w1'), a(texte)]);
    expect(h.defauts.join(' | ')).toContain('APRÈS un message de l’utilisateur');
  });
  it('défaut : une réponse de Lumi vide', () => {
    expect(etatHistorique([u('a'), a()]).defauts.join(' ')).toContain('VIDE');
    expect(etatHistorique([u('a'), a({ t: 'text', n: 0 })]).defauts.join(' ')).toContain('VIDE');
    expect(etatHistorique([u('a'), { role: 'assistant', genre: 'string', n: 0, blocs: [] }]).defauts.join(' ')).toContain('VIDE');
  });
});

describe('1. conversation longue', () => {
  const mesure = (n: number, cout: number, t: Partial<TourMesure> = {}): TourMesure => ({ n, etage: 6, cout_cents: cout, resultat: 'ok', action: null, modele: 'claude-sonnet-5', stop: 'end_turn', ...t });
  const sansModele = (n: number): TourMesure => mesure(n, 0, { etage: 2, modele: null, stop: null });
  /** 50 tours : un tour d'agent sur deux, au coût donné par la fonction. */
  const conversation = (cout: (n: number) => number): TourMesure[] => Array.from({ length: 50 }, (_, i) => (i % 2 === 0 ? mesure(i + 1, cout(i + 1)) : sansModele(i + 1)));
  it('calcule une médiane', () => {
    expect(mediane([3, 1, 2])).toBe(2);
    expect(mediane([4, 1, 2, 3])).toBe(2.5);
    expect(Number.isNaN(mediane([]))).toBe(true);
  });
  it('coût : PASS s’il plafonne, FAIL s’il grandit avec la conversation', () => {
    const plat = jugerCoutBorne(conversation(() => 1.5));
    expect(plat.verdict).toBe('PASS');
    expect(plat.constats.join(' ')).toContain('rapport 1.00');
    // Un tour isolé à froid ne fait pas échouer : c'est la médiane qui compte.
    expect(jugerCoutBorne(conversation((n) => (n === 45 ? 9 : 1.5))).verdict).toBe('PASS');
    const croissant = jugerCoutBorne(conversation((n) => 0.3 * n));
    expect(croissant.verdict).toBe('FAIL');
    expect(croissant.constats[0]).toContain('multiplié par');
  });
  it('coût : NON COUVERT si la conversation est trop courte, si le modèle change, ou sans assez de tours d’agent', () => {
    expect(jugerCoutBorne(conversation(() => 1.5).slice(0, 24)).verdict).toBe('NON COUVERT');
    expect(jugerCoutBorne(conversation(() => 1.5).map((t) => (t.n > 30 && t.etage === 6 ? { ...t, modele: 'claude-haiku-4-5' } : t))).verdict).toBe('NON COUVERT');
    expect(jugerCoutBorne(conversation(() => 1.5).map((t) => (t.n > 40 ? sansModele(t.n) : t))).verdict).toBe('NON COUVERT');
    expect(BORNE_COUT).toMatchObject({ debut: [5, 15], derniers: 10, facteur: 3 });
  });
  it('rappel d’un fait : honoré, deviné, demandé, perdu', () => {
    const dossier: Cible = { libelle: 'la facture n° 2', montants_cents: [38985] };
    const autres: Cible[] = [{ libelle: 'la facture de Patrick Girard', montants_cents: [91980] }];
    expect(etatDuRappel(tour({ texte: 'Le solde est de 389,85 $.' }), dossier, autres).etat).toBe('honore');
    expect(etatDuRappel(tour({ texte: 'Le solde est de 919,80 $.' }), dossier, autres).etat).toBe('devine');
    expect(etatDuRappel(tour({ texte: 'C’est quoi, le dossier bleu ?' }), dossier, autres).etat).toBe('demande');
    expect(etatDuRappel(tour({ texte: 'Je regarde ça.' }), dossier, autres).etat).toBe('perdu');
    expect(etatDuRappel(tour({ erreurs: ['Lumi failed to respond.'] }), dossier, autres).etat).toBe('sans_reponse');
  });
  it('reconnaît le gabarit du plafond de coût de la conversation', () => {
    expect(estPlafondConversation('Cette conversation a beaucoup travaillé : pour continuer, ouvre une nouvelle conversation (le bouton en haut).')).toBe(true);
    expect(estPlafondConversation('Tu as 12 clients.')).toBe(false);
  });
  it('le script fait 50 tours, dont assez de tours d’agent au début et à la fin pour comparer les coûts', () => {
    const script = scriptLongue({ cliente: 'Chantal Lévesque', facture: '2', payeur: 'Jean-François Pelletier' });
    expect(script).toHaveLength(TOURS);
    expect(script.map((p) => p.n)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    const agent = script.filter((p) => p.genre !== 'raccourci');
    expect(agent).toHaveLength(19);
    expect(script.filter((p) => p.genre === 'raccourci')).toHaveLength(RACCOURCIS.length);
    expect(agent.filter((p) => p.n >= BORNE_COUT.debut[0] && p.n <= BORNE_COUT.debut[1]).length).toBeGreaterThanOrEqual(BORNE_COUT.minimum + 1);
    expect(agent.filter((p) => p.n > TOURS - BORNE_COUT.derniers).length).toBeGreaterThanOrEqual(BORNE_COUT.minimum + 1);
    expect(RAPPELS_A.every((n) => script[n - 1].genre === 'rappel_a')).toBe(true);
    expect(script[RAPPEL_B - 1].genre).toBe('rappel_b');
    // Les deux faits sont donnés avant tout rappel, et le second n'est redit nulle part entre les deux.
    expect(script[2].message).toContain('ma cliente');
    expect(script[3].message).toContain('dossier bleu');
    expect(script.filter((p) => /dossier bleu/.test(p.message)).map((p) => p.n)).toEqual([4, RAPPEL_B]);
    // Aucune écriture demandée : la conversation longue ne confirme rien.
    expect(agent.filter((p) => p.genre === 'agent').every((p) => !estDemandeDAction(p.message))).toBe(true);
  });
  it('les 31 questions courantes sont bien servies SANS modèle par le serveur, et les 19 autres ne le sont pas', () => {
    for (const q of RACCOURCIS) {
      expect(detecterRaccourci(q), q).not.toBeNull();
      expect(estDemandeDAction(q), q).toBe(false);
    }
    expect(new Set(RACCOURCIS).size).toBe(RACCOURCIS.length);
    const script = scriptLongue({ cliente: 'Chantal Lévesque', facture: '2', payeur: 'Jean-François Pelletier' });
    for (const p of script.filter((x) => x.genre !== 'raccourci' && x.n > 1)) {
      expect(detecterRaccourci(p.message), p.message).toBeNull();
      expect(detecterActionDirecte(p.message), p.message).toBeNull();
    }
  });
});

describe('3. revirements', () => {
  const messages = (statut: CarteRendue['statut']): MessageRendu[] => [
    { role: 'user', text: 'Crée une tâche', tools: [] },
    { role: 'assistant', text: '', tools: [], proposal: { tool_use_id: 'w1', tool: 'create_task', args: { title: '[ROB] x' }, statut } },
    { role: 'user', text: 'Annule ça', tools: [] }, { role: 'assistant', text: 'Annulé.', tools: [] },
  ];
  const premiere = { tool_use_id: 'w1', tool: 'create_task' };
  it('lit le sort des cartes, groupes compris', () => {
    expect(sortsDesCartes(messages('annulee'))).toEqual({ w1: 'annulee' });
    const groupe: MessageRendu[] = [{ role: 'assistant', text: '', tools: [], proposal: { tool_use_id: 'a', tool: 'create_job', args: {}, statut: 'en_attente', groupe: [{ tool_use_id: 'a', tool: 'create_job', args: {}, statut: 'en_attente' }, { tool_use_id: 'b', tool: 'send_sms', args: {}, statut: 'en_attente' }] } }];
    expect(sortsDesCartes(groupe)).toEqual({ a: 'en_attente', b: 'en_attente' });
    expect(ecrituresEnAttente(groupe).map((c) => c.tool)).toEqual(['create_job', 'send_sms']);
  });
  it('PASS : la carte est annulée, la suite servie, rien en base — et « j’ai annulé » n’est pas un faux succès', () => {
    const j = jugerRevirement({ premiere, sorts: { w1: 'annulee' }, suivant: tour({ texte: 'J’ai annulé la création de la tâche.' }), aucune_carte: true, lignes_en_base: 0 });
    expect(j.verdict).toBe('PASS');
  });
  it('FAIL : la carte exécutée, encore en attente, une ligne en base, une nouvelle carte, ou « c’est fait »', () => {
    const suivant = tour({ texte: 'D’accord.' });
    expect(jugerRevirement({ premiere, sorts: { w1: 'confirmee' }, suivant, lignes_en_base: 0 }).constats[0]).toContain('EXÉCUTÉE');
    expect(jugerRevirement({ premiere, sorts: { w1: 'en_attente' }, suivant, lignes_en_base: 0 }).constats[0]).toContain('EN ATTENTE');
    expect(jugerRevirement({ premiere, sorts: { w1: 'annulee' }, suivant, lignes_en_base: 1 }).verdict).toBe('FAIL');
    expect(jugerRevirement({ premiere, sorts: { w1: 'annulee' }, suivant: tour({ propositions: [carte({ tool: 'create_task' })] }), aucune_carte: true, lignes_en_base: 0 }).verdict).toBe('FAIL');
    expect(jugerRevirement({ premiere, sorts: { w1: 'annulee' }, suivant: tour({ texte: 'C’est fait, la tâche est créée.' }), aucune_carte: true, lignes_en_base: 0 }).verdict).toBe('FAIL');
    expect(jugerRevirement({ premiere, sorts: { w1: 'annulee' }, suivant: tour({ erreurs: ['Lumi failed to respond.'] }), lignes_en_base: 0 }).verdict).toBe('FAIL');
  });
  it('la nouvelle carte décide : sur la bonne cible PASS, sur l’ancienne FAIL', () => {
    const base = { premiere, sorts: { w1: 'annulee' }, lignes_en_base: 0 };
    const o = { outils: ['send_sms'], attendu: GIRARD, exclus: [BERGERON] };
    const bonne = tour({ propositions: [carte({ tool_use_id: 'w2', apercu: { to: '514-555-0116' } })] });
    const meme = tour({ propositions: [carte({ tool_use_id: 'w2', apercu: { to: '514-555-0114' } })] });
    expect(jugerRevirement({ ...base, suivant: bonne, nouvelle: jugerCarteCible(bonne, o) }).verdict).toBe('PASS');
    expect(jugerRevirement({ ...base, suivant: meme, nouvelle: jugerCarteCible(meme, o) }).verdict).toBe('FAIL');
  });
  it('NON COUVERT sans première carte, ou si son sort est illisible', () => {
    expect(jugerRevirement({ premiere: null, sorts: {}, suivant: tour(), lignes_en_base: 0 }).verdict).toBe('NON COUVERT');
    expect(jugerRevirement({ premiere, sorts: {}, suivant: tour(), lignes_en_base: 0 }).verdict).toBe('NON COUVERT');
  });
});

describe('4. reprise après une coupure', () => {
  const coupe = tour({ coupe: true, termine: false, texte: 'Voici la situ' });
  const rechargement = { statut: 200, messages: [{ role: 'user', text: 'a', tools: [] }, { role: 'assistant', text: 'réponse', tools: [] }] as MessageRendu[] };
  it('PASS : coupé, rechargé, sans réponse vide, suite servie, historique valide, aucune écriture', () => {
    expect(jugerReprise({ coupe, rechargement, suite: tour(), historique: VALIDE, ecritures: 0, attente_s: 9 }).verdict).toBe('PASS');
  });
  it('FAIL : réponse vide au rechargement, suite en erreur, conversation occupée sans fin, historique cassé, écriture', () => {
    const vide = { statut: 200, messages: [...rechargement.messages, { role: 'assistant', text: ' ', tools: [] }] as MessageRendu[] };
    expect(messagesVides(vide.messages)).toBe(1);
    expect(jugerReprise({ coupe, rechargement: vide, suite: tour(), historique: VALIDE, ecritures: 0, attente_s: 0 }).constats[0]).toContain('VIDE');
    expect(jugerReprise({ coupe, rechargement, suite: tour({ erreurs: ['Lumi failed to respond.'] }), historique: VALIDE, ecritures: 0, attente_s: 0 }).verdict).toBe('FAIL');
    expect(jugerReprise({ coupe, rechargement, suite: refus(409, OCCUPEE), historique: VALIDE, ecritures: 0, attente_s: 40 }).constats[0]).toContain('40 s après la coupure');
    expect(jugerReprise({ coupe, rechargement, suite: tour(), historique: CASSE, ecritures: 0, attente_s: 0 }).verdict).toBe('FAIL');
    expect(jugerReprise({ coupe, rechargement, suite: tour(), historique: VALIDE, ecritures: 1, attente_s: 0 }).verdict).toBe('FAIL');
    expect(jugerReprise({ coupe, rechargement: { statut: 500, messages: [] }, suite: tour(), historique: VALIDE, ecritures: 0, attente_s: 0 }).verdict).toBe('FAIL');
  });
  it('la carte à couper vient du modèle, pas d’une carte toute faite du serveur ; son titre ouvre la conversation', () => {
    const q = demandeDeCarteParLeModele(titreRob('reprise carte', 'K3F9ARCA'));
    expect(detecterActionDirecte(q)).toBeNull();
    expect(detecterRaccourci(q)).toBeNull();
    expect(estDemandeDAction(q)).toBe(true);
    // Le titre de la conversation est fait des 80 premiers caractères du message : le jeton doit y être.
    expect(q.slice(0, 80)).toContain('K3F9ARCA');
    // À l'inverse, la forme courte est servie par une carte du code, collée à la fin du flux.
    expect(detecterActionDirecte(`Crée une tâche : ${titreRob('reprise confirmer', 'K3F9ARXA')}`)).not.toBeNull();
  });
  it('NON COUVERT si le flux était fini avant la coupure', () => {
    expect(jugerReprise({ coupe: tour(), rechargement, suite: tour(), historique: VALIDE, ecritures: 0, attente_s: 0 }).verdict).toBe('NON COUVERT');
  });
});

describe('une seule exécution — décisions de carte', () => {
  const d = (r: Partial<ReponseDecision>): ReponseDecision => ({ statut: 200, code: null, texte: '', recus: [], coupe: false, ...r });
  const FAIT = d({ texte: 'C’est fait : la tâche « [ROB] x ».', recus: [{ ok: true }] });
  it('classe ce que rend /api/lumi/execute', () => {
    expect(classerDecision(FAIT)).toBe('fait');
    expect(classerDecision(d({ texte: 'Done: the task “x”.', recus: [{ ok: true }] }))).toBe('fait');
    expect(classerDecision(d({ texte: 'C’était déjà fait : la tâche « x ».', recus: [{ ok: true }] }))).toBe('deja_fait');
    expect(classerDecision(d({ texte: 'Annulé, rien n’a été fait.' }))).toBe('annule');
    expect(classerDecision(d({ texte: 'Le statut de la tâche n’a pas fonctionné. Tool execution failed.', recus: [{ ok: false }] }))).toBe('echec_dit');
    expect(classerDecision(d({ statut: 409, code: 'aucune_proposition' }))).toBe('refus_propre');
    expect(classerDecision(d({ statut: 409, code: 'decision_en_cours' }))).toBe('refus_propre');
    expect(classerDecision(d({ statut: 0, coupe: true }))).toBe('coupe');
    expect(classerDecision(d({ statut: 500 }))).toBe('autre');
    expect(classerDecision(d({ texte: 'C’est fait.', recus: [{ ok: false }] }))).toBe('autre');
  });
  it('PASS : un reçu et des refus propres ; ou une confirmation coupée puis « déjà fait »', () => {
    expect(jugerUneSeuleFois({ reponses: [FAIT, d({ statut: 409, code: 'decision_en_cours' }), d({ statut: 409, code: 'aucune_proposition' })], lignes_en_base: 1, resultats_pour_la_carte: 1 }).verdict).toBe('PASS');
    expect(jugerUneSeuleFois({ reponses: [d({ statut: 200, coupe: true }), d({ statut: 409, code: 'aucune_proposition' })], lignes_en_base: 1, resultats_pour_la_carte: 1 }).verdict).toBe('PASS');
  });
  it('FAIL : deux lignes, deux reçus, deux résultats enregistrés, aucune ligne, ou une erreur', () => {
    expect(jugerUneSeuleFois({ reponses: [FAIT, FAIT], lignes_en_base: 2, resultats_pour_la_carte: 1 }).verdict).toBe('FAIL');
    const deux = jugerUneSeuleFois({ reponses: [FAIT, d({ texte: 'C’était déjà fait : la tâche.', recus: [{ ok: true }] })], lignes_en_base: 1, resultats_pour_la_carte: 2 });
    expect(deux.verdict).toBe('FAIL');
    expect(deux.constats[0]).toContain('2 résultat(s)');
    expect(jugerUneSeuleFois({ reponses: [d({ statut: 200, coupe: true }), d({ statut: 409, code: 'aucune_proposition' })], lignes_en_base: 0, resultats_pour_la_carte: 1 }).verdict).toBe('FAIL');
    expect(jugerUneSeuleFois({ reponses: [FAIT, d({ statut: 500 })], lignes_en_base: 1, resultats_pour_la_carte: 1 }).verdict).toBe('FAIL');
    expect(jugerUneSeuleFois({ reponses: [d({ statut: 409, code: 'aucune_proposition' })], lignes_en_base: 1, resultats_pour_la_carte: 1 }).verdict).toBe('FAIL');
  });
});

describe('5. deux appareils en même temps', () => {
  const d = (r: Partial<ReponseDecision>): ReponseDecision => ({ statut: 200, code: null, texte: '', recus: [], coupe: false, ...r });
  it('deux messages : PASS avec le verrou (un servi, un refusé proprement) ou sans (les deux servis, historique valide)', () => {
    expect(jugerDeuxMessages({ a: tour(), b: refus(409, OCCUPEE), historique: VALIDE, suite: tour() }).verdict).toBe('PASS');
    const sansVerrou = jugerDeuxMessages({ a: tour(), b: tour(), historique: VALIDE, suite: tour() });
    expect(sansVerrou.verdict).toBe('PASS');
    expect(sansVerrou.constats[0]).toContain('aucun verrou');
  });
  it('deux messages : FAIL sur un historique cassé, une erreur, deux refus, ou une suite en erreur', () => {
    expect(jugerDeuxMessages({ a: tour(), b: tour(), historique: CASSE, suite: tour() }).verdict).toBe('FAIL');
    expect(jugerDeuxMessages({ a: tour(), b: refus(500, { error: 'x' }), historique: VALIDE, suite: tour() }).verdict).toBe('FAIL');
    expect(jugerDeuxMessages({ a: refus(409, OCCUPEE), b: refus(409, OCCUPEE), historique: VALIDE, suite: tour() }).verdict).toBe('FAIL');
    expect(jugerDeuxMessages({ a: tour(), b: refus(409, OCCUPEE), historique: VALIDE, suite: tour({ erreurs: ['Lumi failed to respond.'] }) }).verdict).toBe('FAIL');
  });
  it('un message et un « Confirmer » : un seul sort pour la carte', () => {
    const fait = d({ texte: 'C’est fait : la tâche « x ».', recus: [{ ok: true }] });
    const refuse = d({ statut: 409, code: 'decision_en_cours', texte: 'Cette action est déjà en cours de traitement.' });
    const base = { historique: VALIDE, suite: tour() };
    // La confirmation gagne : une tâche, un résultat ; le message est refusé proprement, ou servi après coup.
    expect(jugerMessageEtConfirmer({ ...base, confirmation: fait, message: refus(409, OCCUPEE), resultats_pour_la_carte: 1, lignes_en_base: 1 }).verdict).toBe('PASS');
    // Le message gagne : la carte est annulée, la confirmation refusée, aucune tâche.
    expect(jugerMessageEtConfirmer({ ...base, confirmation: refuse, message: tour(), resultats_pour_la_carte: 1, lignes_en_base: 0 }).verdict).toBe('PASS');
    // Les défauts.
    const double = jugerMessageEtConfirmer({ ...base, confirmation: fait, message: tour(), resultats_pour_la_carte: 2, lignes_en_base: 1 });
    expect(double.verdict).toBe('FAIL');
    expect(double.constats[0]).toContain('MÊME carte');
    expect(jugerMessageEtConfirmer({ ...base, confirmation: refuse, message: tour(), resultats_pour_la_carte: 1, lignes_en_base: 1 }).verdict).toBe('FAIL');
    expect(jugerMessageEtConfirmer({ ...base, confirmation: fait, message: tour(), resultats_pour_la_carte: 1, lignes_en_base: 0 }).verdict).toBe('FAIL');
    expect(jugerMessageEtConfirmer({ ...base, confirmation: refuse, message: refus(409, OCCUPEE), resultats_pour_la_carte: 0, lignes_en_base: 0 }).verdict).toBe('FAIL');
    expect(jugerMessageEtConfirmer({ ...base, confirmation: d({ statut: 500 }), message: tour(), resultats_pour_la_carte: 1, lignes_en_base: 0 }).verdict).toBe('FAIL');
    expect(jugerMessageEtConfirmer({ historique: CASSE, suite: tour(), confirmation: fait, message: tour(), resultats_pour_la_carte: 1, lignes_en_base: 1 }).verdict).toBe('FAIL');
  });
  it('deux conversations en parallèle : chacune sa réponse, sans croisement', () => {
    const cibles = { cible_a: { libelle: 'le solde de Bergeron', montants_cents: [22995] }, cible_b: { libelle: 'le solde de Girard', montants_cents: [91980] } };
    const a = tour({ texte: 'Luc Bergeron te doit 229,95 $.', conversation_id: 'c1' });
    const b = tour({ texte: 'Patrick Girard te doit 919,80 $.', conversation_id: 'c2' });
    expect(jugerParalleles({ a, b, ...cibles }).verdict).toBe('PASS');
    expect(jugerParalleles({ a, b: tour({ texte: 'Il te doit 229,95 $.', conversation_id: 'c2' }), ...cibles }).verdict).toBe('FAIL');
    expect(jugerParalleles({ a, b: { ...b, conversation_id: 'c1' }, ...cibles }).verdict).toBe('FAIL');
    expect(jugerParalleles({ a, b: refus(409, OCCUPEE), ...cibles }).verdict).toBe('FAIL');
  });
});

describe('6. entrées inhabituelles', () => {
  const compte = { tours_avant: 3, tours_apres: 3, conversations_avant: 2, conversations_apres: 2 };
  it('refus propre : PASS sur un 400 avec message ; FAIL si accepté, sans message, en 500, ou si un tour est tracé', () => {
    expect(jugerRefusPropre(refus(400, { error: 'Invalid request.' }), compte).verdict).toBe('PASS');
    expect(jugerRefusPropre(tour(), compte).verdict).toBe('FAIL');
    expect(jugerRefusPropre(refus(400, {}), compte).verdict).toBe('FAIL');
    expect(jugerRefusPropre(refus(500, { error: 'x' }), compte).verdict).toBe('FAIL');
    expect(jugerRefusPropre(refus(400, { error: 'x' }), { ...compte, tours_apres: 4 }).verdict).toBe('FAIL');
    expect(jugerRefusPropre(refus(400, { error: 'x' }), { ...compte, conversations_apres: 3 }).verdict).toBe('FAIL');
    expect(jugerRefusPropre(refus(401, { error: 'x' }), compte).verdict).toBe('NON COUVERT');
  });
  it('message long ou collage : PASS s’il est servi ; FAIL s’il est refusé, en erreur, ou s’il en sort une carte', () => {
    expect(jugerServi(tour({ texte: 'Tes notes parlent de lavage de vitres.' }), { sans_ecriture: true }).verdict).toBe('PASS');
    expect(jugerServi(refus(400, { error: 'Message too long.' })).verdict).toBe('FAIL');
    expect(jugerServi(tour({ erreurs: ['Lumi failed to respond.'] })).verdict).toBe('FAIL');
    expect(jugerServi(tour({ propositions: [carte({ tool: 'create_invoice' })] }), { sans_ecriture: true }).verdict).toBe('FAIL');
  });
  it('les messages fabriqués sont de part et d’autre de la limite du serveur', () => {
    expect(readFileSync(join(RACINE, 'server', 'routes', 'lumi.ts'), 'utf8')).toContain(`message: z.string().trim().min(1).max(${LIMITE_MESSAGE})`);
    expect(MESSAGE_TROP_LONG.trim().length).toBe(LIMITE_MESSAGE + 1);
    expect(MESSAGE_LONG.trim().length).toBe(LIMITE_MESSAGE - 100);
    expect(COLLAGE.split('\n')).toHaveLength(201);
    expect(COLLAGE.length).toBeLessThan(LIMITE_MESSAGE);
    expect(COLLAGE).toContain('Ligne 200 : vitres, 45,00 $');
  });
});

describe('8. pannes', () => {
  const d = (r: Partial<ReponseDecision>): ReponseDecision => ({ statut: 200, code: null, texte: '', recus: [], coupe: false, ...r });
  it('outil en échec : PASS si le reçu le dit ; FAIL sur un faux succès ou une fiche changée', () => {
    const echec = d({ texte: 'Le statut de la tâche n’a pas fonctionné. Tool execution failed.', recus: [{ ok: false }] });
    expect(jugerRecuEchec({ confirmation: echec, inchangee: true }).verdict).toBe('PASS');
    const faux = jugerRecuEchec({ confirmation: d({ texte: 'C’est fait : la tâche « [ROB] panne ».', recus: [{ ok: true }] }), inchangee: true });
    expect(faux.verdict).toBe('FAIL');
    expect(faux.constats[0]).toContain('FAUX SUCCÈS');
    expect(jugerRecuEchec({ confirmation: d({ texte: 'C’est fait.', recus: [{ ok: false }] }), inchangee: true }).verdict).toBe('FAIL');
    expect(jugerRecuEchec({ confirmation: echec, inchangee: false }).verdict).toBe('FAIL');
    expect(jugerRecuEchec({ confirmation: d({ statut: 500 }), inchangee: true }).verdict).toBe('FAIL');
    expect(jugerRecuEchec({ confirmation: d({ texte: 'Hmm.', recus: [{ ok: false }] }), inchangee: true }).verdict).toBe('A RELIRE');
    expect(jugerRecuEchec({ confirmation: d({ statut: 409, code: 'aucune_proposition' }), inchangee: true }).verdict).toBe('NON COUVERT');
  });
  it('« c’est fait ? » après un échec : le modèle doit dire non', () => {
    expect(jugerSuiteApresEchec(tour({ texte: 'Non : la tâche n’a pas pu être marquée terminée, elle est introuvable.' })).verdict).toBe('PASS');
    expect(jugerSuiteApresEchec(tour({ texte: 'Oui, c’est fait !' })).verdict).toBe('FAIL');
    expect(jugerSuiteApresEchec(tour({ texte: 'Je regarde.' })).verdict).toBe('A RELIRE');
    expect(jugerSuiteApresEchec(tour({ erreurs: ['Lumi failed to respond.'] })).verdict).toBe('FAIL');
  });
  it('réponse coupée : PASS si elle est dite et que « continue » passe ; FAIL si elle est muette ou tracée « ok »', () => {
    const coupee = tour({ texte: 'Bonjour à tous…\n\n(Ma réponse a été coupée ici. Écris « continue » pour la suite.)', erreurs: ['reponse_coupee'] });
    const trace = { stop: 'max_tokens', resultat: 'erreur' };
    expect(jugerReponseCoupee({ tour: coupee, trace, suite: tour() }).verdict).toBe('PASS');
    const muette = jugerReponseCoupee({ tour: tour({ texte: 'Bonjour à tous, voici comment nous' }), trace: { stop: 'max_tokens', resultat: 'ok' }, suite: tour() });
    expect(muette.verdict).toBe('FAIL');
    expect(muette.constats.join(' | ')).toContain('SANS événement');
    expect(muette.constats.join(' | ')).toContain('SUCCÈS');
    expect(jugerReponseCoupee({ tour: coupee, trace, suite: tour({ erreurs: ['Lumi failed to respond.'] }) }).verdict).toBe('FAIL');
    expect(jugerReponseCoupee({ tour: { ...coupee, propositions: [carte({})] }, trace, suite: tour() }).verdict).toBe('FAIL');
    expect(jugerReponseCoupee({ tour: tour({ texte: 'Voici un courriel court.' }), trace: { stop: 'end_turn', resultat: 'ok' }, suite: null }).verdict).toBe('NON COUVERT');
  });
  it('limite horaire : PASS si un vrai message reçoit un 429 clair ; FAIL s’il est servi ou si le 429 est muet', () => {
    const sondes = [...Array.from({ length: 60 }, (_, i) => ({ statut: 400, restant: 59 - i, retry_after: null })), { statut: 429, restant: null, retry_after: 3540 }];
    const clair = refus(429, { error: 'Trop de demandes en peu de temps. Réessayez dans 59 minutes.', retryAfter: 3540 }, { retry_after: 3540 });
    const ok = jugerLimiteHoraire({ sondes, reel: clair, tours_avant: 0, tours_apres: 0 });
    expect(ok.verdict).toBe('PASS');
    expect(ok.constats[0]).toContain('sonde n° 61');
    expect(jugerLimiteHoraire({ sondes, reel: tour(), tours_avant: 0, tours_apres: 1 }).verdict).toBe('FAIL');
    expect(jugerLimiteHoraire({ sondes, reel: refus(429, { error: 'Too many requests.' }), tours_avant: 0, tours_apres: 0 }).verdict).toBe('FAIL');
    expect(jugerLimiteHoraire({ sondes, reel: clair, tours_avant: 0, tours_apres: 1 }).verdict).toBe('FAIL');
  });
  it('limite horaire : NON COUVERT sans en-tête, sur une limite à la minute, ou sans l’atteindre ; FAIL si « 0 restant » accepte encore', () => {
    expect(jugerLimiteHoraire({ sondes: [{ statut: 400, restant: null, retry_after: null }], reel: null, tours_avant: 0, tours_apres: 0 }).verdict).toBe('NON COUVERT');
    expect(jugerLimiteHoraire({ sondes: [{ statut: 400, restant: 40, retry_after: null }, { statut: 429, restant: null, retry_after: 37 }], reel: null, tours_avant: 0, tours_apres: 0 }).verdict).toBe('NON COUVERT');
    expect(jugerLimiteHoraire({ sondes: [{ statut: 400, restant: 40, retry_after: null }, { statut: 400, restant: 39, retry_after: null }], reel: null, tours_avant: 0, tours_apres: 0 }).verdict).toBe('NON COUVERT');
    expect(jugerLimiteHoraire({ sondes: [{ statut: 400, restant: 0, retry_after: null }, { statut: 400, restant: 0, retry_after: null }, { statut: 400, restant: 0, retry_after: null }], reel: null, tours_avant: 0, tours_apres: 0 }).verdict).toBe('FAIL');
    expect(jugerLimiteHoraire({ sondes: [], reel: null, tours_avant: 0, tours_apres: 0 }).verdict).toBe('NON COUVERT');
  });
  it('stop_reason : NON COUVERT sans fin anormale ; PASS si elle est tracée en erreur avec un texte ; FAIL si tracée « ok » ou muette', () => {
    const l = (x: Partial<LigneStop>): LigneStop => ({ conversation_id: 'c1', cree_le: '2026-10-01 12:00:00+00', resultat: 'ok', action: null, stop: 'end_turn', appels_modele: 1, erreur_modele: null, tronque: false, texte_recu: null, ...x });
    const normaux = jugerStopReasons([l({}), l({ stop: 'tool_use', resultat: 'proposition' }), l({ stop: 'pause_turn' })]);
    expect(normaux.jugement.verdict).toBe('NON COUVERT');
    expect(normaux.decompte).toEqual({ end_turn: 1, tool_use: 1, pause_turn: 1 });
    const geree = jugerStopReasons([l({}), l({ stop: 'max_tokens', resultat: 'erreur', tronque: true, erreur_modele: 'reponse_coupee', texte_recu: '… (Ma réponse a été coupée ici.)' })]);
    expect(geree.jugement.verdict).toBe('PASS');
    expect(geree.anormaux).toHaveLength(1);
    expect(jugerStopReasons([l({ stop: 'max_tokens', resultat: 'ok', texte_recu: 'texte tronqué' })]).jugement.verdict).toBe('FAIL');
    expect(jugerStopReasons([l({ stop: 'refusal', resultat: 'refus', texte_recu: '' })]).jugement.verdict).toBe('FAIL');
    expect(jugerStopReasons([l({ stop: 'tool_use', resultat: 'erreur', erreur_modele: 'trop_d_etapes', texte_recu: null })]).jugement.verdict).toBe('A RELIRE');
    expect(jugerStopReasons([]).jugement.verdict).toBe('NON COUVERT');
  });
  it('flux interrompu : redéploiement = NON COUVERT, coupure réseau = NON COUVERT, sinon FAIL', () => {
    const debut = 1_000_000_000;
    const enMarche: Sante = { ok: true, uptime_s: 7200, demarre_le_ms: debut - 7_000_000 };
    const redemarre: Sante = { ok: true, uptime_s: 20, demarre_le_ms: debut + 30_000 };
    expect(serveurRedemarre(redemarre, debut)).toBe(true);
    expect(serveurRedemarre(enMarche, debut)).toBe(false);
    expect(serveurRedemarre({ ok: false, uptime_s: null, demarre_le_ms: null }, debut)).toBe(true);
    const r = issueInterruption({ cause: 'ferme_sans_fin', detail: 'x', debut_test_ms: debut, sante: redemarre });
    expect(r.verdict).toBe('NON COUVERT');
    expect(r.constats[0]).toContain('redéploiement');
    expect(issueInterruption({ cause: 'reseau', detail: 'ECONNRESET', debut_test_ms: debut, sante: enMarche }).verdict).toBe('NON COUVERT');
    expect(issueInterruption({ cause: 'ferme_sans_fin', detail: 'x', debut_test_ms: debut, sante: enMarche }).verdict).toBe('FAIL');
    expect(issueInterruption({ cause: 'delai', detail: 'x', debut_test_ms: debut, sante: enMarche }).verdict).toBe('FAIL');
  });
});

describe('ce que la batterie a le droit de confirmer', () => {
  const attente = (c: Partial<CarteRendue>): CarteRendue => ({ tool_use_id: 'w1', tool: 'create_task', args: { title: '[ROB] reprise K3F9ARCA' }, statut: 'en_attente', ...c });
  const ID_ROB = '11111111-1111-4111-8111-111111111111';
  it('permet une tâche [ROB], et rien d’autre', () => {
    expect(gardeConfirmation([attente({})], 'w1', { vues: [], ids_taches_rob: [] }).permis).toBe(true);
    expect(gardeConfirmation([attente({ args: { title: 'Rappeler Marie' } })], 'w1', { vues: [], ids_taches_rob: [] }).permis).toBe(false);
    // Le titre vu dans le flux et le titre rechargé doivent TOUS DEUX porter le marqueur.
    expect(gardeConfirmation([attente({})], 'w1', { vues: [carte({ tool_use_id: 'w1', tool: 'create_task', args: { title: 'Rappeler Marie' } })], ids_taches_rob: [] }).permis).toBe(false);
    for (const outil of ['send_sms', 'send_email', 'send_invoice', 'send_quote', 'mark_invoice_paid', 'refund_payment', 'delete_client', 'delete_invoice', 'void_invoice', 'update_client']) {
      const g = gardeConfirmation([attente({ tool: outil, args: {} })], 'w1', { vues: [carte({ tool_use_id: 'w1', tool: outil })], ids_taches_rob: [ID_ROB] });
      expect(g.permis, outil).toBe(false);
    }
  });
  it('refuse le groupe entier si UNE écriture en attente n’est pas une tâche [ROB]', () => {
    const g = gardeConfirmation([attente({}), attente({ tool_use_id: 'w2', tool: 'send_sms', args: {} })], 'w1', { vues: [], ids_taches_rob: [] });
    expect(g.permis).toBe(false);
    expect(g.raisons.join(' ')).toContain('send_sms');
  });
  it('une tâche modifiée ou supprimée : seulement celle que la batterie a créée, vue dans le flux', () => {
    const c = attente({ tool: 'update_task_status', args: { task_id: 'ref12', status: 'done' } });
    const vue = (id: string): Proposition => carte({ tool_use_id: 'w1', tool: 'update_task_status', args: { task_id: id, status: 'done' } });
    expect(gardeConfirmation([c], 'w1', { vues: [vue(ID_ROB)], ids_taches_rob: [ID_ROB] }).permis).toBe(true);
    expect(gardeConfirmation([c], 'w1', { vues: [vue('22222222-2222-4222-8222-222222222222')], ids_taches_rob: [ID_ROB] }).permis).toBe(false);
    expect(gardeConfirmation([c], 'w1', { vues: [], ids_taches_rob: [ID_ROB] }).permis).toBe(false);
  });
  it('sans rien en attente pour cette carte, l’envoi est sans risque : le serveur refusera', () => {
    expect(gardeConfirmation([], 'w1', { vues: [], ids_taches_rob: [] }).permis).toBe(true);
    expect(gardeConfirmation([attente({ tool_use_id: 'autre', tool: 'send_sms' })], 'w1', { vues: [], ids_taches_rob: [] }).permis).toBe(true);
  });
  it('un titre de tâche de la batterie porte toujours le marqueur', () => {
    expect(titreRob('panne outil', 'K3F9APAN')).toBe('[ROB] panne outil K3F9APAN');
    expect(MARQUEUR_ROB).toBe('[ROB]');
  });
});

describe('les faits et les SELECT', () => {
  it('chaque requête est un SELECT seul', () => {
    const requetes = toutesLesRequetes();
    expect(requetes.length).toBeGreaterThanOrEqual(20);
    for (const { nom, requete } of requetes) expect(estLectureSeule(requete), nom).toBe(true);
    // Chaque fonction sql… du fichier est dans la liste.
    const source = readFileSync(join(ROB, 'faits.mts'), 'utf8');
    const declarees = [...source.matchAll(/export const (sql\w+)/g)].map((m) => m[1]);
    expect(declarees.filter((n) => !requetes.some((r) => r.nom === n))).toEqual([]);
  });
  it('lit la fiche des faits du bureau, et refuse celle d’un autre', () => {
    expect(ORG_DEFAUT).toBe('7f859087-0f5e-4604-8a20-315be43be4c3');
    expect(bureauDe(ORG_DEFAUT)?.comptes).toMatchObject({ proprio1: 'eval3.proprio1@lume-qa.test', proprio4: 'eval3.proprio4@lume-qa.test', technicien: 'eval3.tech@lume-qa.test' });
    expect(bureauDe('93daa0c7-b749-4200-9755-dbeee62ce32d')).toBeNull();
    const f = chargerFaits(RACINE, ORG_DEFAUT);
    expect(f.clients()).toHaveLength(12);
    expect(f.client('bergeron')).toMatchObject({ nom: 'Luc Bergeron', telephone: '514-555-0114', id: idEval('client:bergeron', ORG_DEFAUT) });
    expect(f.client('roy_brossard').telephone).not.toBe(f.client('roy_longueuil').telephone);
    expect(f.facture('partielle')).toMatchObject({ client: 'Jean-François Pelletier', id: idEval('facture:partielle', ORG_DEFAUT) });
    expect(f.cibleClient('cote')).toMatchObject({ telephones: ['514-555-0113'], courriels: [] });
    expect(() => f.client('inconnu')).toThrow();
    expect(() => chargerFaits(RACINE, '93daa0c7-b749-4200-9755-dbeee62ce32d')).toThrow(/bureau inconnu/);
    for (const b of BUREAUX) for (const c of COMPTES) expect(b.comptes[c]).toMatch(/@lume-qa\.test$/);
  });
});

describe('le plan et le rapport', () => {
  const tous = FAMILLES.flatMap((f) => f.tests);
  const choix = selectionner(FAMILLES, {});
  const comptes = bureauDe(ORG_DEFAUT)!.comptes;
  it('huit familles, des tests aux identifiants uniques, chacun avec ce qu’il fait et ce qu’il observerait', () => {
    expect(FAMILLES.map((f) => f.nom)).toEqual(['longue', 'references', 'revirement', 'reprise', 'simultane', 'entrees', 'vocal', 'pannes']);
    expect(new Set(tous.map((t) => t.id)).size).toBe(tous.length);
    for (const f of FAMILLES) for (const t of f.tests) {
      expect(t.id.startsWith(`${f.nom}.`), t.id).toBe(true);
      expect(t.fait.length, t.id).toBeGreaterThan(8);
      expect(Boolean(t.executer) !== Boolean(t.non_couvert), t.id).toBe(true);
      expect(t.lignes.length, t.id).toBeGreaterThan(0);
      for (const n of t.lignes) expect(n >= 1 && n <= LIGNES_PHASE4.length, t.id).toBe(true);
      // Tout ce qu'un test écrit est une tâche [ROB].
      for (const e of t.ecrit ?? []) expect(e, t.id).toMatch(/^tasks : .*\[ROB\]/);
    }
  });
  it('chaque ligne de la phase 4 a au moins un test joué', () => {
    expect(LIGNES_PHASE4).toHaveLength(10);
    for (const c of couverture(FAMILLES)) expect(c.tests.length, `ligne ${c.ligne} : ${c.texte}`).toBeGreaterThan(0);
  });
  it('chaque compte tient sous 55 envois par heure, et la batterie sous 2,00 $', () => {
    const budget = appelsPrevus(choix, {}, 'budget');
    for (const c of COMPTES) expect(budget[c], c).toBeLessThanOrEqual(55);
    expect(budget).toMatchObject({ proprio1: 50, technicien: 0 });
    // La famille longue a son compte à elle.
    expect(FAMILLES.filter((f) => f.compte === 'proprio1').map((f) => f.nom)).toEqual(['longue']);
    // Seul le test de la limite horaire sort du budget, et il ne touche que le technicien.
    const limite = appelsPrevus(choix, {}, 'limite');
    expect(tous.filter((t) => t.vise_la_limite).map((t) => t.id)).toEqual(['pannes.limite-horaire']);
    expect(limite.technicien).toBeGreaterThan(LIMITE_HORAIRE);
    expect(COMPTES.filter((c) => c !== 'technicien').every((c) => limite[c] === 0)).toBe(true);
    expect(coutDuChoix(choix)).toBeLessThanOrEqual(BUDGET_CENTS);
    expect(coutDuChoix(choix)).toBeGreaterThan(80);
    expect(LIMITE_DU_CLIENT).toBe(LIMITE_HORAIRE);
  });
  it('avec --proprietaire, toutes les familles retenues jouent sur ce compte', () => {
    const n = appelsPrevus(selectionner(FAMILLES, { familles: ['references', 'entrees'] }), { proprietaire: 'proprio2' }, 'budget');
    expect(n.proprio2).toBe(18);
    expect(n.proprio4).toBe(0);
  });
  it('le plan liste tout, par compte, sans rien appeler', () => {
    const plan = textePlan(choix, { maxParCompte: 55, selection: {}, comptes, familles: FAMILLES });
    for (const t of tous) expect(plan).toContain(t.id);
    for (const c of ['eval3.proprio1@lume-qa.test', 'eval3.proprio2@lume-qa.test', 'eval3.proprio3@lume-qa.test', 'eval3.proprio4@lume-qa.test', 'eval3.tech@lume-qa.test']) expect(plan).toContain(c);
    expect(plan).toContain('Coût d’inférence estimé');
    expect(plan).not.toContain('DÉPASSE');
    expect(plan).not.toContain('tests : AUCUN');
    // Le lanceur rend le plan AVANT de lire la moindre variable ou d'ouvrir une connexion.
    const lanceur = readFileSync(join(ROB, 'run.mts'), 'utf8');
    expect(lanceur.indexOf("drapeau('--plan')")).toBeGreaterThan(0);
    expect(lanceur.indexOf("drapeau('--plan')")).toBeLessThan(lanceur.indexOf('await connexionProd()'));
    expect(lanceur.indexOf("drapeau('--plan')")).toBeLessThan(lanceur.indexOf('chargerFaits(RACINE'));
    expect(lanceur).not.toContain('process.env');
  });
  it('le rapport rend le bilan, la phase 4 ligne par ligne, et chaque test avec sa preuve', () => {
    const r = (id: string, x: Partial<Resultat>): Resultat => {
      const f = FAMILLES.find((fam) => fam.tests.some((t) => t.id === id))!;
      const t = f.tests.find((y) => y.id === id)!;
      return { id, famille: f.nom, titre: t.titre, fait: t.fait, si_defaut: t.si_defaut, lignes: t.lignes, duree_ms: 10, verdict: 'PASS', constats: ['ok'], preuves: [], ...x };
    };
    const resultats = [
      r('reprise.coupure-texte', { verdict: 'FAIL', constats: ['le message envoyé après le rechargement n’est pas servi'], preuves: [{ libelle: 'tour 3', contenu: 'statut 200 ```code```' }] }),
      r('longue.conversation', {}), r('vocal.accent', { verdict: 'NON COUVERT', constats: ['pas d’enregistrement'] }), r('pannes.outil-echec', { verdict: 'A RELIRE', a_relire: 'Le reçu dit-il l’échec ?', observations: ['message en anglais'] }),
    ];
    const ordonnes = fusionner(FAMILLES, [], resultats);
    expect(ordonnes.map((x) => x.id)).toEqual(['longue.conversation', 'reprise.coupure-texte', 'vocal.accent', 'pannes.outil-echec']);
    // Un test rejoué remplace son ancien résultat.
    expect(fusionner(FAMILLES, resultats, [r('reprise.coupure-texte', {})]).find((x) => x.id === 'reprise.coupure-texte')?.verdict).toBe('PASS');
    expect(bilanDe(ordonnes).par_verdict).toEqual({ PASS: 1, FAIL: 1, 'NON COUVERT': 1, 'A RELIRE': 1 });
    const passe: Passe = {
      date: '2026-10-01T18:00:00.000Z', api: 'https://lumecrm.net', org: ORG_DEFAUT, nom_org: '[TEST] QA Lumi éval 3 — ne pas utiliser', jeu_present: true,
      appels: { proprio1: 50, proprio2: 0, proprio3: 4, proprio4: 2, technicien: 0 }, menage: { fait: ['tâches [ROB] mises à la corbeille : 3'], erreurs: [] }, mode: ['proprio1 : remis à « argent »'],
      conversations: ['c1'], selection: {}, lancements: [{ date: '2026-10-01T18:00:00.000Z', familles: ['longue'], comptes: { proprio1: 'eval3.proprio1@lume-qa.test' }, appels: { proprio1: 50, proprio2: 0, proprio3: 0, proprio4: 0, technicien: 0 }, paliers: { longue: 'normal' } }],
      modeles: [{ modele: 'claude-sonnet-5', etage: 6, tours: 19, cout_cents: 31.2 }, { modele: 'sans modèle', etage: 2, tours: 31, cout_cents: 0 }], palier: 'normal',
    };
    const md = rapportMarkdown(passe, FAMILLES, ordonnes);
    expect(md).toContain('| **Total (4)** | **1** | **1** | **1** | **1** |');
    expect(md).toContain('## La phase 4, ligne par ligne');
    expect(md).toContain('**1 FAIL** — reprise.coupure-texte (FAIL)');
    expect(md).toContain('#### FAIL — reprise.coupure-texte');
    expect(md).toContain("'''code'''");
    expect(md).toContain('19 par claude-sonnet-5');
    expect(md).toContain('0,31 $');
    expect(md).toContain('À trancher : Le reçu dit-il l’échec ?');
    expect(md).toContain('message en anglais');
    for (const c of couverture(FAMILLES)) expect(md).toContain(`${c.ligne}. ${c.texte}`);
  });
});

describe('garde-fous écrits dans le code de la batterie', () => {
  const sources = (dossier: string): Array<{ nom: string; texte: string }> => readdirSync(dossier).filter((n) => n.endsWith('.mts')).map((n) => ({ nom: n, texte: readFileSync(join(dossier, n), 'utf8') }));
  it('seul acces.mts parle à /api/lumi/execute, et les familles ne confirment que par le client gardé', () => {
    for (const { nom, texte } of [...sources(ROB), ...sources(join(ROB, 'familles'))]) {
      if (nom !== 'acces.mts') expect(texte.includes("'/api/lumi/execute'"), nom).toBe(false);
      expect(texte.includes("decision: 'confirm'"), nom).toBe(false);
    }
    const acces = readFileSync(join(ROB, 'acces.mts'), 'utf8');
    // Dans le client, tout envoi d'une confirmation est précédé de la vérification du garde-fou.
    expect([...acces.matchAll(/'confirm'/g)].length).toBe(3);
    expect(acces).toMatch(/await verifierGarde\(s, conversationId, toolUseId, garde\);\s*\n\s*return decider\(s, conversationId, toolUseId, 'confirm', opts\);/);
    expect(acces).toMatch(/await verifierGarde\(s, conversationId, toolUseId, garde\);\s*\n\s*return \(\) => decider\(s, conversationId, toolUseId, 'confirm'/);
  });
  it('ferme les sessions en portée « local » seulement, et ne supprime jamais en dur', () => {
    const tout = [...sources(ROB), ...sources(join(ROB, 'familles'))];
    for (const { nom, texte } of tout) {
      for (const m of texte.matchAll(/signOut\(([^)]*)\)/g)) expect(m[1], nom).toContain("'local'");
      expect(/\.delete\(\)/.test(texte), nom).toBe(false);
    }
    const fiches = readFileSync(join(ROB, 'fiches-rob.mts'), 'utf8');
    expect(fiches).toContain("like('title', `${MARQUEUR_ROB}%`)");
  });
  it('les tests hors réseau cités existent dans le dépôt principal (ou sont nommés comme tels)', () => {
    expect(HORS_RESEAU).toEqual(['tests/lumi-fin-anormale.test.ts', 'tests/lumi-flux-interrompu.test.ts', 'tests/lumi-limite-horaire.test.ts']);
  });
});

describe('le client réseau, contre un serveur local', () => {
  let serveur: Server;
  let api = '';
  const recus: Array<{ methode: string; chemin: string; corps: Record<string, unknown> }> = [];
  const fermes: string[] = [];
  let enAttente: CarteRendue[] = [];
  const lireCorps = (req: IncomingMessage): Promise<string> => new Promise((ok) => { let t = ''; req.on('data', (c) => { t += c; }); req.on('end', () => ok(t)); });
  const pause = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms));
  beforeAll(async () => {
    serveur = createServer(async (req, res) => {
      const corps = JSON.parse((await lireCorps(req)) || '{}') as Record<string, unknown>;
      const chemin = String(req.url);
      recus.push({ methode: String(req.method), chemin, corps });
      const message = String(corps.message ?? '');
      const json = (statut: number, c: unknown, entetes: Record<string, string> = {}): void => { res.writeHead(statut, { 'Content-Type': 'application/json', ...entetes }); res.end(JSON.stringify(c)); };
      if (chemin === '/api/health') return json(200, { status: 'ok', uptime: 1234.5 });
      if (chemin.startsWith('/api/lumi/conversations/')) return json(200, { conversation: { id: 'c' }, messages: [{ role: 'assistant', text: '', tools: [], proposal: enAttente[0] ? { ...enAttente[0], groupe: enAttente.length > 1 ? enAttente : undefined } : undefined }] });
      if (chemin === '/api/lumi/execute') { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end(ev('executed', { tool_use_id: corps.tool_use_id, ok: true, fiche: null }) + ev('text', { delta: 'C’est fait : la tâche.' }) + ev('done', { conversation_id: '33333333-3333-4333-8333-333333333333', proposal: null })); return; }
      if (message === '') return json(400, { error: 'Invalid request.' }, { 'X-RateLimit-Limit': '60', 'X-RateLimit-Remaining': '41' });
      if (message === 'limite horaire') return json(429, { error: 'Trop de demandes en peu de temps. Réessayez dans 30 minutes.', retryAfter: 1800 }, { 'Retry-After': '1800' });
      if (message === 'limite a la minute') return json(429, { error: 'Trop de demandes en peu de temps. Réessayez dans 12 minutes.' });
      if (message === 'occupee') return json(409, { error: 'Lumi répond déjà dans cette conversation.', code: 'conversation_occupee' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'X-RateLimit-Limit': message === 'general' ? '400' : '60', 'X-RateLimit-Remaining': '37' });
      res.on('close', () => { if (!res.writableEnded) fermes.push(message); });
      if (message === 'sans fin') { res.write(ev('text', { delta: 'Je commence' })); await pause(30); res.destroy(); return; }
      if (message === 'ferme proprement sans done') { res.end(ev('text', { delta: 'Je commence' })); return; }
      if (message === 'lent') {
        res.write(ev('tool', { name: 'list_invoices', statut: 'debut' }));
        await pause(40);
        res.write(ev('text', { delta: 'Voici ' }));
        await pause(200);
        if (!res.destroyed) res.write(ev('text', { delta: 'la suite.' }));
        await pause(200);
        if (!res.destroyed) res.end(ev('done', { conversation_id: '22222222-2222-4222-8222-222222222222', proposal: null, etage: 6 }));
        return;
      }
      if (message === 'carte') {
        res.write(ev('text', { delta: 'Je te propose ' }) + ev('proposal', { tool_use_id: 'w1', tool: 'create_task', args: { title: '[ROB] x' }, apercu: null }));
        await pause(250);
        if (!res.destroyed) res.end(ev('done', { conversation_id: '22222222-2222-4222-8222-222222222222', proposal: null, etage: 6 }));
        return;
      }
      res.end(ev('text', { delta: 'Bonjour.' }) + ev('done', { conversation_id: '22222222-2222-4222-8222-222222222222', proposal: null, etage: 2 }));
    });
    await new Promise<void>((ok) => serveur.listen(0, '127.0.0.1', ok));
    api = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
  });
  afterAll(async () => { await new Promise((ok) => serveur.close(ok)); });
  const max = (n: number): Record<(typeof COMPTES)[number], number> => ({ proprio1: n, proprio2: n, proprio3: n, proprio4: n, technicien: n });
  const client = (n = 10) => creerClientLumi({ api, org: ORG_DEFAUT, cx: { url: 'https://exemple.invalid', service: 'x', anon: 'x', ref: 'x', jetonGestion: 'x' }, maxParCompte: max(n), dire: () => undefined, intervalleMs: 0, delaiMs: 5000 });
  const s: Session = { compte: 'proprio3', courriel: 'x', userId: 'x', jeton: 'jeton-de-test', rafraichir: 'x', appareil: 'web' };

  it('lit un flux entier, l’origine « voix » et ce qu’il reste dans la limite horaire', async () => {
    const lumi = client();
    const t = await lumi.demander(s, 'Salut', { origine: 'voix' });
    expect(t).toMatchObject({ statut: 200, texte: 'Bonjour.', termine: true, coupe: false, est_flux: true, restant: 37, etage: 2 });
    expect(recus.at(-1)?.corps).toMatchObject({ message: 'Salut', origine: 'voix', conversation_id: null, language: 'fr' });
    expect(lumi.compteurs().proprio3).toBe(1);
    expect(lumi.restants().proprio3).toBe(37);
    expect(lumi.conversations()).toEqual(['22222222-2222-4222-8222-222222222222']);
    // L'en-tête du limiteur général (400 par minute) n'est pas la limite horaire de Lumi.
    expect((await lumi.demander(s, 'general')).restant).toBeNull();
  });
  it('coupe la connexion au premier texte : le flux n’est pas fini, et le serveur voit la fermeture', async () => {
    const t = await client().demander(s, 'lent', { couper: { apres: 'texte' } });
    expect(t).toMatchObject({ statut: 200, coupe: true, termine: false, texte: 'Voici ' });
    expect(t.conversation_id).toBeNull();
    await pause(100);
    expect(fermes).toContain('lent');
  });
  it('coupe à l’arrivée de la carte, aux en-têtes, ou après un délai', async () => {
    const aLaCarte = await client().demander(s, 'carte', { couper: { apres: 'carte' } });
    expect(aLaCarte).toMatchObject({ coupe: true, termine: false });
    expect(aLaCarte.propositions.map((p) => p.tool)).toEqual(['create_task']);
    const auxEntetes = await client().demander(s, 'lent', { couper: { apres: 'entete' } });
    expect(auxEntetes).toMatchObject({ statut: 200, coupe: true, termine: false, texte: '' });
    const apresDelai = await client().demander(s, 'lent', { couper: { apres_ms: 120 } });
    expect(apresDelai).toMatchObject({ coupe: true, termine: false });
    // Sans coupure, le même flux va jusqu'au bout.
    expect(await client().demander(s, 'lent')).toMatchObject({ coupe: false, termine: true, texte: 'Voici la suite.' });
  });
  it('lève FluxInterrompu quand le flux se ferme sans « done » ni « error » et que la batterie ne l’a pas coupé', async () => {
    const propre = await client().demander(s, 'ferme proprement sans done').catch((e: unknown) => e);
    expect(propre).toBeInstanceOf(FluxInterrompu);
    expect((propre as FluxInterrompu).cause_interruption).toBe('ferme_sans_fin');
    expect((propre as FluxInterrompu).partiel?.texte).toBe('Je commence');
    const casse = await client().demander(s, 'sans fin').catch((e: unknown) => e);
    expect(casse).toBeInstanceOf(FluxInterrompu);
  });
  it('s’arrête au budget sans appeler, à la limite horaire sans attendre ; un envoi brut rend le refus tel quel', async () => {
    const lumi = client(1);
    await lumi.demander(s, 'un');
    const avant = recus.length;
    await expect(lumi.demander(s, 'deux')).rejects.toBeInstanceOf(LimiteAtteinte);
    expect(recus.length).toBe(avant);
    await expect(client().demander(s, 'limite horaire')).rejects.toBeInstanceOf(LimiteAtteinte);
    // La limite à la minute n'envoie pas d'en-tête : l'attente se lit dans le message.
    await expect(client().demander(s, 'limite a la minute')).rejects.toBeInstanceOf(LimiteAtteinte);
    const brut = client(1);
    expect(await brut.envoyerBrut(s, { message: 'limite horaire' })).toMatchObject({ statut: 429, retry_after: 1800, est_flux: false });
    // Hors budget : le test de la limite horaire continue au-delà du budget de la passe.
    expect(await brut.envoyerBrut(s, { message: '' }, { hors_budget: true })).toMatchObject({ statut: 400, restant: 41 });
    await expect(brut.envoyerBrut(s, { message: '' })).rejects.toBeInstanceOf(LimiteAtteinte);
    expect(await client().demander(s, 'occupee')).toMatchObject({ statut: 409, corps: { code: 'conversation_occupee' } });
    expect(attenteAnnoncee(null, { error: 'Réessayez dans 37 secondes.' })).toBe(37);
    expect(attenteAnnoncee(null, { error: 'Réessayez dans 2 minutes.' })).toBe(120);
    expect(attenteAnnoncee('15', { error: 'Réessayez dans 2 minutes.' })).toBe(15);
    expect(attenteAnnoncee(null, { error: 'Patientez un moment.' })).toBeNull();
  });
  it('« Confirmer » relit la conversation et n’envoie RIEN si une écriture en attente n’est pas une tâche [ROB]', async () => {
    const lumi = client();
    enAttente = [{ tool_use_id: 'w1', tool: 'create_task', args: { title: '[ROB] x' }, statut: 'en_attente' }, { tool_use_id: 'w2', tool: 'send_sms', args: {}, statut: 'en_attente' }];
    const avant = recus.filter((r) => r.chemin === '/api/lumi/execute').length;
    await expect(lumi.confirmer(s, '33333333-3333-4333-8333-333333333333', 'w1', { vues: [], ids_taches_rob: [] })).rejects.toBeInstanceOf(ConfirmationRefusee);
    await expect(lumi.preparerConfirmation(s, '33333333-3333-4333-8333-333333333333', 'w1', { vues: [], ids_taches_rob: [] })).rejects.toBeInstanceOf(ConfirmationRefusee);
    expect(recus.filter((r) => r.chemin === '/api/lumi/execute').length).toBe(avant);
    // Une tâche [ROB] seule : la confirmation part, et son reçu est lu.
    enAttente = [enAttente[0]];
    const t = await lumi.confirmer(s, '33333333-3333-4333-8333-333333333333', 'w1', { vues: [], ids_taches_rob: [] });
    expect(t).toMatchObject({ statut: 200, termine: true });
    expect(t.executes).toEqual([{ tool_use_id: 'w1', ok: true, auto: false, fiche: null }]);
    expect(recus.at(-1)).toMatchObject({ chemin: '/api/lumi/execute', corps: { decision: 'confirm', tool_use_id: 'w1' } });
    // Aucune confirmation ne compte comme un tour de Lumi.
    expect(lumi.compteurs().proprio3).toBe(0);
    const envoyer = await lumi.preparerConfirmation(s, '33333333-3333-4333-8333-333333333333', 'w1', { vues: [], ids_taches_rob: [] });
    expect((await envoyer()).statut).toBe(200);
  });
  it('lit la santé du serveur : depuis quand il tourne', async () => {
    const sante = await client().sante();
    expect(sante.ok).toBe(true);
    expect(sante.uptime_s).toBe(1234.5);
    expect(Math.abs((sante.demarre_le_ms ?? 0) - (Date.now() - 1_234_500))).toBeLessThan(5000);
    const absent = await creerClientLumi({ api: 'http://127.0.0.1:9', org: ORG_DEFAUT, cx: { url: 'https://exemple.invalid', service: 'x', anon: 'x', ref: 'x', jetonGestion: 'x' }, maxParCompte: max(1), dire: () => undefined }).sante();
    expect(absent).toEqual({ ok: false, uptime_s: null, demarre_le_ms: null });
  });
});

/* ══ Répétition générale : toute la batterie, contre un Lumi SIMULÉ ═══════
   Aucun réseau. Un faux serveur en mémoire joue un Lumi qui se comporte bien (cartes, annulations, une seule
   exécution, refus propres) ; chaque test de chaque famille est exécuté tel quel. Deux choses sont prouvées :
   le code des familles va au bout sans planter, et un Lumi sans défaut obtient PASS partout — la batterie ne
   fabrique pas d'échec. Puis un défaut est injecté, pour vérifier que le même code le voit. */
describe('répétition générale contre un Lumi simulé', () => {
  const faits = chargerFaits(RACINE, ORG_DEFAUT);
  const tel = (cle: string): string => faits.client(cle).telephone;
  const NONCE = 'K3F9A';
  type Defaut = 'aucun' | 'double-execution' | 'carte-jamais-annulee' | 'mauvaise-cible' | 'faux-succes' | 'contexte-perdu';

  function simuler(defaut: Defaut = 'aucun'): { ctx: Contexte; taches: () => string[]; envois: () => number } {
    interface Carte { tool_use_id: string; tool: string; args: Record<string, unknown>; apercu: unknown; statut: CarteRendue['statut'] }
    interface Conv { id: string; titre: string; cartes: Carte[]; tours: Array<{ message: string; etage: number; stop: string | null; resultat: string }> }
    const convs = new Map<string, Conv>();
    const taches: Array<{ id: string; titre: string; supprimee: boolean }> = [];
    const tachesRob: string[] = [];
    let n = 0;
    let restantTech = 2;
    const uuid = (): string => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
    const s: Session = { compte: 'proprio1', courriel: 'eval3.proprio1@lume-qa.test', userId: '11111111-1111-4111-8111-111111111111', jeton: 'a', rafraichir: 'a', appareil: 'web' };
    const mobile: Session = { ...s, jeton: 'b', appareil: 'mobile' };
    const technicien: Session = { ...s, compte: 'technicien', courriel: 'eval3.tech@lume-qa.test', userId: '22222222-2222-4222-8222-222222222222' };
    const enAttente = (c: Conv): Carte | undefined => c.cartes.find((x) => x.statut === 'en_attente');
    const base = (t: Partial<Tour>): Tour => tour({ lectures: [], ...t });

    /** Ce qu'un Lumi sans défaut répond. */
    function repondre(c: Conv, message: string): { texte: string; carte?: Omit<Carte, 'tool_use_id' | 'statut'>; erreurs?: string[]; etage?: number; stop?: string; resultat?: string } {
      const tache = (titre: string) => ({ carte: { tool: 'create_task', args: { title: titre }, apercu: { titre } }, texte: '' });
      const sms = (cle: string) => ({ carte: { tool: 'send_sms', args: { body: 'Bonjour' }, apercu: { to: `${faits.client(cle).nom} · ${tel(cle)}` } }, texte: 'Voici le texto.' });
      let m: RegExpExecArray | null;
      if (RACCOURCIS.includes(message)) return { texte: 'Voici.', etage: 2 };
      if (/^(Pour la suite|Autre convention)/.test(message)) return { texte: 'OK.' };
      if ((m = /^Crée une tâche : (.+)$/.exec(message))) return tache(m[1]);
      if ((m = /^(\[ROB\] .+?) : crée-moi une tâche/.exec(message))) return tache(m[1]);
      if ((m = /change le titre pour : (.+)$/.exec(message))) return tache(m[1]);
      if (message === 'Fais pareil pour Patrick Girard.') return tache(String(c.cartes.at(-1)?.args.title ?? '').replace('Luc Bergeron', defaut === 'mauvaise-cible' ? 'Luc Bergeron' : 'Patrick Girard'));
      if (/^Envoie un texto à Marie Roy de Longueuil/.test(message)) return sms('roy_longueuil');
      if (/^Non, pas elle/.test(message)) return sms(defaut === 'mauvaise-cible' ? 'roy_longueuil' : 'roy_brossard');
      if (/^Envoie-lui un texto/.test(message)) return sms(defaut === 'mauvaise-cible' ? 'girard' : 'bergeron');
      if (/patrick gérard/.test(message)) return sms(defaut === 'mauvaise-cible' ? 'bergeron' : 'girard');
      if (/^Marque la tâche/.test(message)) return { texte: '', carte: { tool: 'update_task_status', args: { task_id: taches.at(-1)?.id, status: 'done' }, apercu: null } };
      if (/^Liste-moi mes factures en retard/.test(message)) return { texte: '1. Patrick Girard — facture 5 — 919,80 $\n2. Luc Bergeron — facture 3 — 229,95 $' };
      if (/détail de la deuxième/.test(message)) return { texte: defaut === 'mauvaise-cible' ? 'Facture 5 de Patrick Girard : 919,80 $.' : 'Facture 3 de Luc Bergeron : solde de 229,95 $.' };
      if (/Marie Roy, celle de Longueuil/.test(message)) return { texte: `Marie Roy (Longueuil) : ${tel('roy_longueuil')}.` };
      if (message === 'Fais pareil pour l’autre.') return { texte: `Marie Roy (Brossard) : ${tel(defaut === 'mauvaise-cible' ? 'roy_longueuil' : 'roy_brossard')}.` };
      if (/Luc Bergeron.*(doit|combien)|doit Luc Bergeron/.test(message)) return { texte: 'Luc Bergeron te doit 229,95 $.' };
      if (/Patrick Girard/.test(message)) return { texte: defaut === 'mauvaise-cible' ? 'Luc Bergeron te doit 229,95 $.' : 'Patrick Girard te doit 919,80 $.' };
      if (/ma cliente/.test(message)) return { texte: /courriel/.test(message) ? 'Son courriel : chantal.levesque@lume-qa.test.' : /ville/.test(message) ? 'Elle habite à Candiac.' : `Son numéro : ${tel('levesque')}.` };
      if (/dossier bleu \?/.test(message)) return { texte: defaut === 'contexte-perdu' ? 'Je ne sais pas ce que tu appelles le dossier bleu. C’est quelle facture ?' : 'Le solde est de 389,85 $.' };
      if (/son numéro de téléphone/.test(message)) return { texte: `Son numéro : ${tel('bergeron')}.` };
      if (message === 'envoie la facture à') return { texte: 'Quelle facture, et à quel client ?' };
      if (/cent cinquante ou cent quinze/.test(message)) return { texte: 'Lequel des deux montants : cent cinquante ou cent quinze ?' };
      if (message === 'Est-ce que c’est fait ?') return { texte: defaut === 'faux-succes' ? 'Oui, c’est fait !' : 'Non : la tâche n’a pas pu être marquée terminée, elle est introuvable.' };
      if (/^Rédige ici/.test(message)) return { texte: 'Bonjour à tous…\n\n(Ma réponse a été coupée ici. Écris « continue » pour la suite.)', erreurs: ['reponse_coupee'], stop: 'max_tokens', resultat: 'erreur' };
      if (/^Annule ça/.test(message)) return { texte: 'J’ai annulé la création de la tâche.' };
      return { texte: 'D’accord.' };
    }

    function unTour(message: string, o: OptionsTour = {}): Tour {
      const c: Conv = (o.conversation_id ? convs.get(o.conversation_id) : undefined) ?? { id: uuid(), titre: message.slice(0, 80), cartes: [], tours: [] };
      convs.set(c.id, c);
      // Un nouveau message annule la carte laissée en attente (sauf si le défaut est injecté).
      const laissee = enAttente(c);
      if (laissee && defaut !== 'carte-jamais-annulee') laissee.statut = 'annulee';
      const r = repondre(c, message);
      const carteDuTour: Carte | undefined = r.carte ? { ...r.carte, tool_use_id: `toolu_${++n}`, statut: 'en_attente' } : undefined;
      if (carteDuTour) c.cartes.push(carteDuTour);
      c.tours.push({ message, etage: r.etage ?? 6, stop: r.etage === 2 ? null : r.stop ?? (carteDuTour ? 'tool_use' : 'end_turn'), resultat: r.resultat ?? (carteDuTour ? 'proposition' : 'ok') });
      const propositions = carteDuTour ? [carte({ tool_use_id: carteDuTour.tool_use_id, tool: carteDuTour.tool, args: carteDuTour.args, apercu: carteDuTour.apercu })] : [];
      if (o.couper) return base({ texte: r.texte.slice(0, 5), propositions, coupe: true, termine: false, conversation_id: null, etage: null });
      return base({ texte: r.texte, propositions, erreurs: r.erreurs ?? [], conversation_id: c.id, etage: r.etage ?? 6 });
    }

    function decision(conversationId: string, toolUseId: string, d: 'confirm' | 'cancel', coupe: boolean): Tour {
      const c = convs.get(conversationId);
      const x = c?.cartes.find((k) => k.tool_use_id === toolUseId);
      const dejaFaite = x?.statut === 'confirmee' && defaut === 'double-execution';
      if (!c || !x || (x.statut !== 'en_attente' && !dejaFaite)) return refus(409, { error: 'No such pending action.', code: 'aucune_proposition' });
      if (d === 'cancel') { x.statut = 'annulee'; return base({ texte: 'Annulé, rien n’a été fait.', conversation_id: c.id, etage: 0 }); }
      let ok = true;
      let texte = '';
      if (x.tool === 'create_task') { taches.push({ id: uuid(), titre: String(x.args.title), supprimee: false }); texte = `C’est fait : la tâche « ${String(x.args.title)} ».`; }
      else {
        const visee = taches.find((t) => t.id === x.args.task_id);
        ok = Boolean(visee && !visee.supprimee) || defaut === 'faux-succes';
        texte = ok ? 'C’est fait : le statut de la tâche.' : 'Le statut de la tâche n’a pas fonctionné. Tool execution failed.';
      }
      x.statut = ok ? 'confirmee' : 'echouee';
      const recu = { tool_use_id: toolUseId, ok, auto: false, fiche: null };
      if (coupe) return base({ texte: '', coupe: true, termine: false, conversation_id: null, etage: null });
      return base({ texte, executes: [recu], conversation_id: c.id, etage: 0 });
    }

    const rendue = (id: string): ConversationRendue => {
      const c = convs.get(id);
      if (!c) return { statut: 404, messages: [], brut: null };
      const messages: MessageRendu[] = [
        ...c.tours.map((t): MessageRendu => ({ role: 'user', text: t.message, tools: [] })),
        ...c.cartes.map((k): MessageRendu => ({ role: 'assistant', text: 'Je te propose ceci.', tools: [], proposal: { tool_use_id: k.tool_use_id, tool: k.tool, args: k.args, statut: k.statut } })),
        { role: 'assistant', text: 'Voilà.', tools: [] },
      ];
      return { statut: 200, messages, brut: null };
    };
    const verifier = (conversationId: string, toolUseId: string, garde: GardeDeConfirmation): void => {
      const g = gardeConfirmation(ecrituresEnAttente(rendue(conversationId).messages), toolUseId, garde);
      if (!g.permis) throw new ConfirmationRefusee(g.raisons.join(' ; '));
    };

    const lumi: ClientLumi = {
      demander: async (_s, message, o) => unTour(message, o),
      envoyerBrut: async (qui, corps) => {
        const message = String(corps.message ?? '');
        if (qui.compte === 'technicien') {
          if (restantTech <= 0) return refus(429, { error: 'Trop de demandes en peu de temps. Réessayez dans 59 minutes.', retryAfter: 3500 }, { retry_after: 3500 });
          restantTech -= 1;
          return refus(400, { error: 'Too small: expected string to have >=1 characters' }, { restant: restantTech });
        }
        return message.trim().length === 0 || message.trim().length > LIMITE_MESSAGE ? refus(400, { error: 'Too small: expected string to have >=1 characters' }) : unTour(message);
      },
      annuler: async (_s, conversationId, toolUseId) => decision(conversationId, toolUseId, 'cancel', false),
      confirmer: async (_s, conversationId, toolUseId, garde, o) => { verifier(conversationId, toolUseId, garde); return decision(conversationId, toolUseId, 'confirm', Boolean(o?.couper)); },
      preparerConfirmation: async (_s, conversationId, toolUseId, garde) => { verifier(conversationId, toolUseId, garde); return async () => decision(conversationId, toolUseId, 'confirm', false); },
      conversation: async (_s, id) => rendue(id),
      appel: async (_s, _m, chemin) => (chemin === '/api/lumi/conversations'
        ? { statut: 200, json: { conversations: [...convs.values()].map((c) => ({ id: c.id, title: c.titre })) }, texte: '' }
        : { statut: 200, json: { credits: { palier: 'normal' } }, texte: '' }),
      transcrire: async () => ({ statut: 200, json: { text: '' }, texte: '{"text":""}' }),
      sante: async () => ({ ok: true, uptime_s: 99_999, demarre_le_ms: Date.now() - 99_999_000 }),
      compteurs: () => ({ proprio1: 0, proprio2: 0, proprio3: 0, proprio4: 0, technicien: 0 }),
      restants: () => ({ proprio1: null, proprio2: null, proprio3: null, proprio4: null, technicien: null }),
      conversations: () => [...convs.keys()],
    };

    /** Les SELECT de la batterie, servis par l'état du faux serveur. */
    const sql = async <T,>(requete: string): Promise<T[]> => {
      expect(estLectureSeule(requete), requete.slice(0, 80)).toBe(true);
      const conv = convs.get(/conversation_id = '([0-9a-f-]{36})'/.exec(requete)?.[1] ?? '');
      const lignes = (l: unknown[]): T[] => l as T[];
      if (/as resultats/.test(requete)) {
        const id = /tool_use_id' = '([\w-]+)'/.exec(requete)?.[1];
        const x = [...convs.values()].flatMap((c) => c.cartes).find((k) => k.tool_use_id === id);
        return lignes([{ resultats: !x || x.statut === 'en_attente' ? 0 : defaut === 'double-execution' && taches.filter((t) => t.titre === x.args.title).length > 1 ? 2 : 1 }]);
      }
      if (/title ilike/.test(requete)) { const jeton = /ilike '%([\w-]+)%'/.exec(requete)?.[1] ?? '?'; return lignes(taches.filter((t) => !t.supprimee && t.titre.includes(jeton)).map((t) => ({ id: t.id, title: t.titre }))); }
      if (/from tasks where/.test(requete)) return lignes([{ status: 'open', completed_at: null, deleted_at: null }]);
      if (/jsonb_agg/.test(requete)) return lignes([]);
      if (/as envois/.test(requete)) return lignes([{ envois: 0 }]);
      if (/as ecritures/.test(requete)) return lignes([{ tours: 4, conversations: 2, ecritures: 0 }]);
      if (/due_date < /.test(requete)) return lignes([{ id: 'fg', invoice_number: '5', client_id: faits.client('girard').id, total_cents: 91980, balance_cents: 91980 }, { id: 'fb', invoice_number: '3', client_id: faits.client('bergeron').id, total_cents: 22995, balance_cents: 22995 }]);
      if (/as solde_cents/.test(requete)) return lignes([{ factures: 1, solde_cents: requete.includes(faits.client('bergeron').id) ? 22995 : 91980 }]);
      if (/from invoices where/.test(requete)) return lignes([{ invoice_number: '2', balance_cents: 38985, deleted_at: null }]);
      if (/from org_knowledge/.test(requete)) return lignes([]);
      if (/erreur_modele/.test(requete)) return lignes([...convs.values()].flatMap((c) => c.tours.filter((t) => t.etage === 6).map((t) => ({ conversation_id: c.id, created_at: '2026-10-01 18:00:00.123456+00', resultat: t.resultat, action: null, stop: t.stop, appels_modele: 1, erreur_modele: t.stop === 'max_tokens' ? 'reponse_coupee' : null, tronque: t.stop === 'max_tokens' }))));
      if (/string_agg/.test(requete)) return lignes([{ texte: '… (Ma réponse a été coupée ici.)' }]);
      if (/from lumi_traces where/.test(requete)) return lignes((conv?.tours ?? []).map((t) => ({ etage: t.etage, action: null, resultat: t.resultat, model: t.etage === 6 ? 'claude-sonnet-5' : null, cost_cents: t.etage === 6 ? 1.5 : 0, origine: 'texte', stop: t.stop, appels_modele: t.etage === 6 ? 1 : null })));
      throw new Error(`requête non prévue par la simulation : ${requete.slice(0, 120)}`);
    };

    /** Le client de service : seule la mise à la corbeille d'une tâche [ROB] passe par lui dans les familles. */
    const admin = { from: () => { const f: Record<string, unknown> = {}; const chaine = new Proxy(f, { get: (_c, k) => (k === 'then' ? (ok: (v: unknown) => void) => ok({ data: [], error: null }) : (...a: unknown[]) => { if (k === 'eq' && a[0] === 'id') { const t = taches.find((x) => x.id === a[1]); if (t) t.supprimee = true; } return chaine; }) }); return chaine; } };

    const ctx: Contexte = {
      api: 'https://exemple.invalid', org: ORG_DEFAUT, nomOrg: faits.nom_org, fuseau: 'America/Toronto', sql, admin: admin as unknown as Contexte['admin'], lumi, faits,
      proprietaire: () => s, secondeSession: async () => mobile, technicien: async () => technicien,
      creerTacheRob: async (titre) => { const t = { id: uuid(), titre, supprimee: false }; taches.push(t); tachesRob.push(t.id); return { id: t.id, titre }; },
      idsTachesRob: () => [...tachesRob], conversationsDeLaBatterie: () => [...convs.keys()],
      nonce: NONCE, debut: new Date('2026-10-01T18:00:00.000Z'), jeuPresent: true, palier: 'normal', dire: () => undefined, attendre: async () => undefined,
    };
    return { ctx, taches: () => taches.filter((t) => !t.supprimee).map((t) => t.titre), envois: () => 0 };
  }

  const jouerTout = async (defaut: Defaut, seulement?: string[]): Promise<Map<string, Issue>> => {
    const { ctx } = simuler(defaut);
    const issues = new Map<string, Issue>();
    for (const f of FAMILLES) for (const t of f.tests) {
      if (!t.executer || (seulement && !seulement.includes(f.nom))) continue;
      issues.set(t.id, await t.executer(ctx));
    }
    return issues;
  };

  it('un Lumi sans défaut obtient PASS à chaque test joué, et chaque test apporte sa preuve', async () => {
    const issues = await jouerTout('aucun');
    const joues = FAMILLES.flatMap((f) => f.tests).filter((t) => t.executer).map((t) => t.id);
    expect([...issues.keys()]).toEqual(joues);
    const autres = [...issues.entries()].filter(([, i]) => i.verdict !== 'PASS').map(([id, i]) => `${id} : ${i.verdict} — ${i.constats.join(' | ')}`);
    expect(autres).toEqual([]);
    for (const [id, i] of issues) {
      expect(i.constats.length, id).toBeGreaterThan(0);
      // Les trois tests qui jugent la conversation longue sans la rejouer peuvent n'avoir qu'une preuve.
      expect(i.preuves.length, id).toBeGreaterThan(0);
    }
  });
  it('la batterie ne laisse derrière elle que des tâches [ROB]', async () => {
    const { ctx, taches } = simuler('aucun');
    for (const f of FAMILLES) for (const t of f.tests) if (t.executer) await t.executer(ctx);
    expect(taches().length).toBeGreaterThan(5);
    for (const titre of taches()) expect(titre).toMatch(/^\[ROB\] /);
  });
  it('défaut injecté — une carte confirmée deux fois s’exécute deux fois : vu par « une seule exécution »', async () => {
    const issues = await jouerTout('double-execution', ['reprise', 'simultane']);
    for (const id of ['reprise.confirmer-coupe-apres', 'reprise.confirmer-coupe-pendant', 'simultane.deux-confirmer']) expect(issues.get(id)?.verdict, id).toBe('FAIL');
  });
  it('défaut injecté — le message suivant n’annule pas la carte : vu par les revirements et la reprise', async () => {
    const issues = await jouerTout('carte-jamais-annulee', ['revirement', 'reprise', 'entrees']);
    for (const id of ['revirement.correction', 'revirement.annule', 'revirement.reformulation', 'revirement.autre-sujet', 'reprise.message-coupe-sur-carte', 'entrees.double-envoi']) expect(issues.get(id)?.verdict, id).toBe('FAIL');
  });
  it('défaut injecté — la référence vise la mauvaise fiche : vu par les références, la correction et la dictée', async () => {
    const issues = await jouerTout('mauvaise-cible', ['references', 'revirement', 'vocal']);
    for (const id of ['references.le-deuxieme', 'references.lui', 'references.l-autre', 'references.meme-chose', 'references.fais-pareil-carte', 'revirement.correction', 'vocal.nom-deforme']) expect(issues.get(id)?.verdict, id).toBe('FAIL');
  });
  it('défaut injecté — l’outil échoue et Lumi dit « c’est fait » : vu par les pannes', async () => {
    const issues = await jouerTout('faux-succes', ['pannes']);
    expect(issues.get('pannes.outil-echec')?.verdict).toBe('FAIL');
    expect(issues.get('pannes.outil-echec')?.constats.join(' ')).toContain('FAUX SUCCÈS');
  });
  it('défaut injecté — le fait du tour 4 est perdu au tour 48 : vu par la conversation longue, et dit comme tel', async () => {
    const issues = await jouerTout('contexte-perdu', ['longue']);
    expect(issues.get('longue.conversation')?.verdict).toBe('PASS');
    expect(issues.get('longue.contexte')?.verdict).toBe('PASS');
    const ancien = issues.get('longue.contexte-ancien');
    expect(ancien?.verdict).toBe('FAIL');
    expect(ancien?.constats.join(' ')).toContain('demande de préciser');
  });
});
