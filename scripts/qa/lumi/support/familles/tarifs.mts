/**
 * Famille 2 — Tarifs.
 * Chaque chiffre attendu est lu dans la page Tarifs (src/pages/marketing/Pricing.tsx, voir
 * ../tarifs.mts) : prix mensuel de chaque forfait, prix d'un utilisateur de plus, premier forfait
 * qui inclut Lumi, le porte-à-porte, les textos et l'API, bureaux inclus, rabais annuel.
 * Tout montant de la réponse doit être un montant de la page ; les crédits Lumi n'ont jamais
 * d'équivalence en dollars.
 */
import { jugerTarif, type AttenteTarif } from '../jugement.mts';
import { FICHIER_TARIFS, annuel, chargerTarifs, forfait, montantsPermis, rabaisPermis, type Fonction, type Tarifs } from '../tarifs.mts';
import { unTour } from '../tour.mts';
import type { Famille, TestSupport } from '../types.mts';

export const TARIFS: Tarifs = chargerTarifs();
const PERMIS = montantsPermis(TARIFS);
const dollars = (n: number): string => `${n} $`;

const minimum = forfait(TARIFS, 'Minimum');
const scale = forfait(TARIFS, 'Scale');
const autopilot = forfait(TARIFS, 'Autopilot');
const indiceAutopilot = TARIFS.forfaits.indexOf(autopilot);

/** Le premier forfait qui inclut une fonction, et ceux qui ne l'incluent pas. */
const depuis = (f: Fonction): { nom: string; exclus: string[] } => {
  const i = TARIFS.premier_forfait[f];
  return { nom: TARIFS.forfaits[i].nom, exclus: TARIFS.forfaits.slice(0, i).map((x) => x.nom) };
};

interface CasTarif { id: string; question: string; attente: AttenteTarif; attendu: string; attente_discutable?: string }

const fonction = (id: string, question: string, f: Fonction): CasTarif => {
  const d = depuis(f);
  return { id, question, attente: { forfait_requis: d.nom, forfaits_exclus: d.exclus }, attendu: `« ${d.nom} »${d.exclus.length ? `, jamais ${d.exclus.join(' ni ')}` : ''}` };
};

const rabaisAutopilot = Math.round(autopilot.rabais_annuel * 100);

export const CAS_TARIFS: CasTarif[] = [
  { id: 'prix-minimum', question: "C'est combien par mois, le forfait Minimum ?", attente: { montants_requis: [minimum.cad.mensuel * 100] }, attendu: dollars(minimum.cad.mensuel) },
  { id: 'prix-scale', question: 'Le forfait Scale, ça coûte combien par mois ?', attente: { montants_requis: [scale.cad.mensuel * 100] }, attendu: dollars(scale.cad.mensuel) },
  { id: 'prix-autopilot', question: 'Quel est le prix mensuel du forfait Autopilot ?', attente: { montants_requis: [autopilot.cad.mensuel * 100] }, attendu: dollars(autopilot.cad.mensuel) },
  { id: 'utilisateur-minimum', question: "Sur le forfait Minimum, ça coûte combien d'ajouter un utilisateur de plus ?", attente: { montants_requis: [minimum.cad.utilisateur * 100] }, attendu: dollars(minimum.cad.utilisateur) },
  { id: 'utilisateur-autopilot', question: "Je suis sur Autopilot : c'est combien par mois pour un utilisateur supplémentaire ?", attente: { montants_requis: [autopilot.cad.utilisateur * 100] }, attendu: dollars(autopilot.cad.utilisateur) },
  fonction('lumi', "Lumi, l'assistant IA, est inclus à partir de quel forfait ?", 'lumi'),
  fonction('porte-a-porte', 'Le module de porte-à-porte est inclus dans quel forfait ?', 'porte_a_porte'),
  fonction('textos', 'À partir de quel forfait je peux envoyer des textos à mes clients ?', 'textos'),
  fonction('api', "L'accès à l'API est offert dans quel forfait ?", 'api'),
  {
    id: 'bureaux', question: 'Combien de bureaux sont inclus dans le forfait Autopilot ?',
    attente: { compte: { noms: ['bureau'], valeur: TARIFS.bureaux[indiceAutopilot], permis: [...new Set(TARIFS.bureaux)] } }, attendu: `${TARIFS.bureaux[indiceAutopilot]} bureaux`,
  },
  {
    id: 'rabais-annuel', question: "Si je paie le forfait Autopilot à l'année, j'ai droit à quel rabais ?",
    attente: { pourcents_requis: [rabaisAutopilot], pourcents_permis: rabaisPermis(TARIFS) },
    attendu: `${rabaisAutopilot} % (soit ${dollars(annuel(autopilot.cad.mensuel, autopilot.rabais_annuel).par_mois)} par mois)`,
    attente_discutable: `La page Tarifs se contredit : ses forfaits portent un rabais annuel par forfait (${TARIFS.forfaits.map((f) => `${f.nom} ${Math.round(f.rabais_annuel * 100)} %`).join(', ')}), mais le texte de sa FAQ (« Y a-t-il un engagement ? ») annonce « un rabais de 15 % » pour tous. L'attente suit le chiffre du forfait.`,
  },
  { id: 'credits-lumi', question: 'Un crédit Lumi, ça vaut combien en dollars ?', attente: { aucun_montant: true }, attendu: 'aucune équivalence en argent' },
];

export const tarifs: Famille = {
  nom: 'tarifs',
  titre: '2. Tarifs',
  prouve: `Le support donne les prix de la page Tarifs (${TARIFS.forfaits.map((f) => `${f.nom} ${f.cad.mensuel} $, +${f.cad.utilisateur} $ par utilisateur`).join(' ; ')} — lus dans ${FICHIER_TARIFS}), n'invente aucun montant, et ne chiffre jamais un crédit Lumi en dollars.`,
  tests: CAS_TARIFS.map((c): TestSupport => ({
    id: `tarifs.${c.id}`,
    titre: `« ${c.question} »`,
    fait: `Un utilisateur pose la question au chat de support ; la page Tarifs dit : ${c.attendu}.`,
    si_defaut: c.attente.aucun_montant
      ? 'Un montant en dollars ou en cents apparaîtrait dans la réponse.'
      : 'Le chiffre de la page manquerait, un montant absent de la page apparaîtrait, ou un forfait qui n’inclut pas la fonction serait présenté comme l’incluant.',
    appels: 1,
    question: c.question,
    ...(c.attente_discutable ? { attente_discutable: c.attente_discutable } : {}),
    executer: (ctx, s) => unTour(ctx.poser, s, `tarifs.${c.id}`, c.question, (o) => jugerTarif(o, PERMIS, c.attente)),
  })),
};
