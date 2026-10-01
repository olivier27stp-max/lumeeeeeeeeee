/**
 * Famille 8 — Langue.
 * « Répond dans la langue de l'utilisateur ; vouvoiement constant ; français québécois correct. »
 *
 * Ce que le code du serveur fait aujourd'hui (server/lib/support/tickets.ts, contexteOrg) : la
 * langue de la réponse vient du COMPTE (préférence de la personne, sinon langue de l'entreprise),
 * pas du message. Les comptes de test sont en français : une question en anglais y reçoit donc,
 * par construction, la réponse française de la FAQ, et un prompt qui dit « Answer in French ».
 * Les deux tests en anglais mesurent cet écart avec l'exigence — ils ne sont pas adoucis.
 */
import { jugerLangue, jugerTarif } from '../jugement.mts';
import { forfait, montantsPermis } from '../tarifs.mts';
import { issue, preuvesDuTour } from '../tour.mts';
import type { Famille, Issue, Observation } from '../types.mts';
import { TARIFS } from './tarifs.mts';

const scale = forfait(TARIFS, 'Scale');
const PERMIS = montantsPermis(TARIFS);

const Q_FAQ_EN = 'How do I add an employee to my team?';
const Q_PRIX_EN = 'How much is the Scale plan per month, and how much does one extra user cost?';
const Q_JOUAL = 'salut la, jveux savoir comment jfais pour envoyer une facture a mon client pis quil paye en ligne avec sa carte';

/** En anglais ET avec les prix de la page : la langue d'abord, puis les chiffres. */
function jugerPrixEnAnglais(o: Observation): Issue {
  const langue = jugerLangue(o, { attendue: 'en' });
  const prix = jugerTarif(o, PERMIS, { montants_requis: [scale.cad.mensuel * 100, scale.cad.utilisateur * 100] });
  if (langue.verdict === 'NON COUVERT') return issue(langue, preuvesDuTour(o));
  const ordre = ['FAIL', 'A RELIRE', 'PASS'] as const;
  const verdict = ordre.find((v) => langue.verdict === v || prix.verdict === v) ?? 'A RELIRE';
  return issue({ verdict, constats: [...langue.constats, ...prix.constats.map((c) => `prix : ${c}`)], a_relire: langue.a_relire ?? prix.a_relire }, preuvesDuTour(o));
}

export const langue: Famille = {
  nom: 'langue',
  titre: '8. Langue',
  prouve: 'Le support répond dans la langue de la question — en anglais avec les mêmes prix, en français soigné et au « vous » à une question écrite en joual sans accents.',
  tests: [
    {
      id: 'langue.anglais-faq', titre: `Question de la FAQ, en anglais : « ${Q_FAQ_EN} »`,
      fait: 'Un utilisateur (compte en français) pose en anglais, mot pour mot, une question de la FAQ.',
      si_defaut: 'La réponse serait en français : la FAQ répond dans la langue du compte, pas dans celle de la question.',
      appels: 1, question: Q_FAQ_EN, langue: 'en',
      executer: async (ctx, s) => { const o = await ctx.poser(s, 'langue.anglais-faq', Q_FAQ_EN); return issue(jugerLangue(o, { attendue: 'en' }), preuvesDuTour(o)); },
    },
    {
      id: 'langue.anglais-prix', titre: `Question de prix, en anglais : « ${Q_PRIX_EN} »`,
      fait: `Un utilisateur (compte en français) demande en anglais le prix du forfait Scale et d’un utilisateur de plus ; la page Tarifs dit ${scale.cad.mensuel} $ et ${scale.cad.utilisateur} $.`,
      si_defaut: 'La réponse serait en français, ou les prix ne seraient pas ceux de la page.',
      appels: 1, question: Q_PRIX_EN, langue: 'en',
      executer: async (ctx, s) => jugerPrixEnAnglais(await ctx.poser(s, 'langue.anglais-prix', Q_PRIX_EN)),
    },
    {
      id: 'langue.joual', titre: `Question en joual, sans accents : « ${Q_JOUAL} »`,
      fait: 'Un utilisateur écrit en joual, sans accents ni apostrophes. La réponse doit rester en français soigné, au « vous ».',
      si_defaut: 'La réponse tutoierait, reprendrait du joual (« pis », « faque »…), serait sans accents, ou passerait à l’anglais.',
      attente_discutable: '« Français québécois correct » n’est pas tranchable par code : sans défaut trouvé, le test rend « A RELIRE », jamais PASS.',
      appels: 1, question: Q_JOUAL,
      executer: async (ctx, s) => { const o = await ctx.poser(s, 'langue.joual', Q_JOUAL); return issue(jugerLangue(o, { attendue: 'fr', soignee: true }), preuvesDuTour(o)); },
    },
  ],
};
