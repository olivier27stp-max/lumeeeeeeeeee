/**
 * « Construire avec Lumi » : un texte d'exemple ne part jamais au client en silence.
 *
 * Vrai cas de prod (2026-10-01, Coquin lavage, « Notification vue du devis ») :
 * le canevas portait une étape « Envoyer un texto » fraîchement ajoutée, avec
 * le texte que l'éditeur y pose (« Bonjour [client_name], c’est
 * [company_name]. Merci ! »). Demande : « fais un message pour notifier le rep
 * en questions qui a envoye le devis ». Lumi a ajouté la notification interne,
 * GARDÉ le texto d'exemple, et répondu seulement « J'ai ajouté une
 * notification interne au responsable du dossier quand le client ouvre son
 * devis. » Publié, chaque client qui ouvre son devis recevait le texto.
 *
 * Trois protections, éprouvées ici avec la VRAIE sortie du modèle ce jour-là :
 *  1. le modèle est prévenu que l'étape n'est pas rédigée (à réécrire ou retirer) ;
 *  2. la réponse cite la notification, mot pour mot, et dit ce qui est retiré ;
 *  3. si le modèle garde quand même le texte d'exemple, la réponse le signale.
 */
import { describe, it, expect, vi } from 'vitest';

const etat: { reponse: string } = { reponse: '{}' };
vi.mock('../server/lib/lumi/llm', () => ({
  isLumiConfigured: () => true,
  clientAnthropic: () => ({
    messages: {
      create: async () => ({
        model: 'claude-sonnet-5', stop_reason: 'end_turn', usage: { input_tokens: 1000, output_tokens: 200 },
        content: [{ type: 'text', text: etat.reponse }],
      }),
    },
  }),
}));
vi.mock('../server/lib/lumi/budget', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../server/lib/lumi/budget')>()),
  reserverBudget: async () => ({ id: 'resa-1', statut: 'ok' }),
  reglerBudget: async () => {},
  journaliserUsage: async () => {},
}));

import { genererParcours, construireMessages, ceQuiAChange, etapesNonRedigees } from '../server/lib/lumi/generer-parcours';
import { ACTIONS } from '../src/lib/automationCatalogue';

const base = { admin: {} as never, orgId: 'org-1', userId: 'u-1' };
const DEMANDE = 'fais un message pour notifier le rep en questions qui a envoye le devis';
const TEXTO_EXEMPLE = 'Bonjour [client_name], c’est [company_name]. Merci !';
const texto = (id: string, body: string, suivant: string | null = null) => ({ id, type: 'action', action: { type: 'send_sms', config: { body } }, suivant });
const notification = (id: string, suivant: string | null = null) => ({
  id, type: 'action', suivant,
  action: { type: 'create_notification', config: { title: 'Devis consulté par le client', body: "[client_name] vient d'ouvrir le devis [quote_number].", destinataire: 'responsable' } },
});
/** Le canevas de ce jour-là. */
const CANEVAS = { trigger_event: 'quote.viewed', steps: [texto('e1', TEXTO_EXEMPLE)] };
/** Ce que le modèle a rendu en prod : le texto d'exemple GARDÉ + la notification. */
const SORTIE_DE_PROD = {
  nom: 'Notification vue du devis', trigger_event: 'quote.viewed',
  resume: "J'ai ajouté une notification interne au responsable du dossier quand le client ouvre son devis.",
  steps: [texto('e1', TEXTO_EXEMPLE, 'e2'), notification('e2')],
};

describe('une étape au texte d’exemple est reconnue', () => {
  it('le texto que l’éditeur pose en ajoutant une étape, en français et en anglais', () => {
    expect(etapesNonRedigees([texto('e1', TEXTO_EXEMPLE)])).toEqual(['e1']);
    expect(etapesNonRedigees([texto('e7', 'Hi [client_name], this is [company_name]. Thank you!')])).toEqual(['e7']);
  });

  it('l’action provisoire d’une automatisation neuve (« À compléter »)', () => {
    expect(etapesNonRedigees([texto('e1', 'À compléter')])).toEqual(['e1']);
    expect(etapesNonRedigees([texto('e1', 'To complete')])).toEqual(['e1']);
  });

  it('TOUT texte par défaut du catalogue (texto, courriel, notification, tâche) — le catalogue peut grandir sans qu’on y repense', () => {
    for (const action of ACTIONS) {
      if (!['send_sms', 'send_email', 'create_notification', 'create_task'].includes(action.cle)) continue;
      const cleTexte = action.cle === 'send_sms' || action.cle === 'send_email' ? 'body' : 'title';
      const champ = action.champs.find((c) => c.cle === cleTexte);
      for (const defaut of [champ?.defaut_fr, champ?.defaut_en]) {
        if (!defaut) continue;
        const etape = { id: 'e1', type: 'action', action: { type: action.cle, config: { [cleTexte]: defaut } }, suivant: null };
        expect(etapesNonRedigees([etape]), `${action.cle} : « ${defaut.slice(0, 40)} »`).toEqual(['e1']);
      }
    }
  });

  it('un texte écrit par l’utilisateur n’est PAS pris pour un exemple', () => {
    expect(etapesNonRedigees([texto('e1', 'Bonjour [client_first_name], merci d’avoir regardé votre devis. — [company_name]')])).toEqual([]);
    expect(etapesNonRedigees([notification('e1')])).toEqual([]);
  });
});

describe('1. le modèle est prévenu', () => {
  it('le parcours envoyé au modèle nomme l’étape non rédigée et dit quoi en faire', () => {
    const parcours = construireMessages(DEMANDE, [], CANEVAS).map((m) => m.content).join('\n');
    expect(parcours).toContain('ÉTAPE NON RÉDIGÉE : e1.');
    expect(parcours).toMatch(/Ne garde JAMAIS une telle étape telle quelle/);
    expect(parcours).toMatch(/sinon RETIRE l'étape et dis-le dans "resume"/);
  });

  it('un parcours aux textes écrits par l’utilisateur ne reçoit pas cette consigne', () => {
    const parcours = construireMessages(DEMANDE, [], { trigger_event: 'quote.viewed', steps: [texto('e1', 'Merci d’avoir regardé votre devis, [client_first_name].')] })
      .map((m) => m.content).join('\n');
    expect(parcours).not.toContain('NON RÉDIGÉE');
  });
});

describe('2. la réponse dit tout ce qui a bougé', () => {
  it('le texto d’exemple retiré et la notification ajoutée : les deux sont cités, mot pour mot', () => {
    const t = ceQuiAChange(CANEVAS.steps, [notification('e1')], true);
    expect(t).toContain('Nouveau texte :');
    expect(t).toContain("• Notification dans Lume, au responsable du client : « Devis consulté par le client — [client_name] vient d'ouvrir le devis [quote_number]. »");
    expect(t).toContain(`Retiré du parcours :\n• Texto : « ${TEXTO_EXEMPLE} »`);
    expect(t).not.toContain('Attention');
  });

  it('une notification sans destinataire va « à toute l’équipe », une tâche est citée par son titre', () => {
    const etapes = [
      { id: 'e1', type: 'action', action: { type: 'create_notification', config: { title: 'Devis vu' } }, suivant: 'e2' },
      { id: 'e2', type: 'action', action: { type: 'create_task', config: { title: 'Rappeler [client_name]' } }, suivant: null },
    ];
    const t = ceQuiAChange(undefined, etapes, true);
    expect(t).toContain('• Notification dans Lume, à toute l’équipe : « Devis vu »');
    expect(t).toContain('• Tâche : « Rappeler [client_name] »');
  });

  it('un message RÉÉCRIT est un nouveau texte, pas un retrait', () => {
    const t = ceQuiAChange([texto('e1', 'Ancien texte du texto.')], [texto('e1', 'Nouveau texte du texto.')], true);
    expect(t).toContain('• Texto : « Nouveau texte du texto. »');
    expect(t).not.toContain('Retiré');
  });

  it('une étape seulement RENUMÉROTÉE par le modèle n’est ni nouvelle ni retirée', () => {
    const avant = [texto('e1', 'Bonjour [client_first_name], merci. — [company_name]')];
    const apres = [notification('e1', 'e2'), texto('e2', 'Bonjour [client_first_name], merci. — [company_name]')];
    const t = ceQuiAChange(avant, apres, true);
    expect(t).toContain('Notification dans Lume');
    expect(t).not.toContain('• Texto');
    expect(t).not.toContain('Retiré');
  });

  it('en anglais', () => {
    const t = ceQuiAChange(CANEVAS.steps, [notification('e1')], false);
    expect(t).toContain('• Notification in Lume, to the client owner : « Devis consulté par le client');
    expect(t).toContain('Removed from the journey:\n• Text : «');
  });
});

describe('3. si le modèle garde quand même le texte d’exemple, l’utilisateur le sait', () => {
  it('la sortie exacte du modèle en prod le 2026-10-01 : la réponse signale le texto qui partirait au client', async () => {
    etat.reponse = JSON.stringify(SORTIE_DE_PROD);
    const r = await genererParcours({ ...base, demande: DEMANDE, langue: 'fr', echanges: [], parcoursActuel: CANEVAS });
    const reponse = r.parcours?.resume ?? '';
    // La phrase de Lumi, puis la notification citée…
    expect(reponse).toContain("J'ai ajouté une notification interne au responsable du dossier");
    expect(reponse).toContain('• Notification dans Lume, au responsable du client : « Devis consulté par le client');
    // … et le texto d'exemple, que la réponse d'origine passait sous silence.
    expect(reponse).toContain('Attention : cette étape porte encore le texte d’exemple de l’éditeur, qui partirait tel quel au client :');
    expect(reponse).toContain(`• Texto : « ${TEXTO_EXEMPLE} »`);
    expect(reponse).toContain('Dis-moi quoi écrire à la place, ou demande-moi de retirer l’étape.');
  });

  it('une notification au texte d’exemple (interne) ne déclenche pas l’alerte « au client »', () => {
    const interne = [{ id: 'e1', type: 'action', action: { type: 'create_notification', config: { title: 'Suivi a faire pour [client_name]' } }, suivant: null }];
    expect(ceQuiAChange(undefined, interne, true)).not.toContain('Attention');
  });
});
