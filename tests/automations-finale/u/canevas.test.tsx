// @vitest-environment jsdom
/**
 * LE CANEVAS — corrections de l'agent U, côté COMPOSANT : le vrai
 * `SequenceCanvas`, monté seul. Un bloc `describe` par ligne.
 */
import { describe, it, expect, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import SequenceCanvas from '../../../src/components/automations/SequenceCanvas';
import type { Etape } from '../../../src/lib/sequenceTypes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Proprietes = Partial<React.ComponentProps<typeof SequenceCanvas>>;

let conteneur: HTMLDivElement;
let racine: Root | null = null;

function monter(steps: Etape[], props: Proprietes = {}) {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => {
    racine!.render(
      <SequenceCanvas
        declencheurLabel="Devis envoyé" steps={steps} fr onSelection={() => {}} onAjouter={() => {}}
        {...props}
      />,
    );
  });
}
afterEach(() => {
  if (racine) { act(() => racine!.unmount()); racine = null; }
  conteneur?.remove();
});

const action = (type: string, config: Record<string, string>, id = 'e1', suivant: string | null = null): Etape =>
  ({ id, type: 'action', action: { type, config }, suivant });
/** Le texte de la carte dont le titre est celui-ci. */
const carte = (titre: string) => Array.from(conteneur.querySelectorAll('button'))
  .find((b) => !b.getAttribute('aria-label') && b.textContent?.includes(titre))?.textContent ?? '';

// ─── Ajustement de la ligne 2 : la carte montre le texte que le bureau ENVOIE ───

describe('la carte d’une étape montre le texte que le bureau ENVOIE (comme le champ principal du panneau)', () => {
  const FR = 'Rabais de 10 % jusqu’au 1er mai.';
  const EN = '10% off until May 1st.';
  const bilingue = [action('send_sms', { body: FR, body_en: EN })];

  it('bureau qui envoie en français : le texte français', () => {
    monter(bilingue, { langueEnvoi: 'fr' });
    expect(carte('Envoyer un texto')).toContain(FR);
    expect(carte('Envoyer un texto')).not.toContain(EN);
  });

  it('bureau qui envoie en ANGLAIS : la version anglaise — celle qui part', () => {
    monter(bilingue, { langueEnvoi: 'en' });
    expect(carte('Envoyer un texto')).toContain(EN);
    expect(carte('Envoyer un texto')).not.toContain(FR);
  });

  it('langue du bureau non fournie : français, le défaut du moteur', () => {
    monter(bilingue);
    expect(carte('Envoyer un texto')).toContain(FR);
  });

  it('bureau anglais, étape SANS version anglaise (ou vide) : le moteur enverra le texte de base — la carte aussi', () => {
    monter([action('send_sms', { body: FR })], { langueEnvoi: 'en' });
    expect(carte('Envoyer un texto')).toContain(FR);
    act(() => racine!.unmount());
    racine = null;
    conteneur.remove();
    monter([action('send_sms', { body: FR, body_en: '   ' })], { langueEnvoi: 'en' });
    expect(carte('Envoyer un texto')).toContain(FR);
  });

  it('un courriel HTML fourni : le TEXTE de la version qui part, pas son balisage', () => {
    const courriel = [action('send_email', {
      subject: 'Votre demande', subject_en: 'Your request',
      body: '<div style="font-family:sans-serif;"><h2>Bonjour [client_first_name],</h2><p>Merci.</p></div>',
      body_en: '<div style="font-family:sans-serif;"><h2>Hi [client_first_name],</h2><p>Thank you.</p></div>',
    })];
    monter(courriel, { langueEnvoi: 'en' });
    expect(carte('Envoyer un courriel')).toContain('Hi [client_first_name],');
    expect(carte('Envoyer un courriel')).not.toMatch(/<div|style=|Bonjour/);
  });

  it('une tâche (pas de `body`) : son titre, dans la langue d’envoi quand il en a deux', () => {
    monter([action('create_task', { title: 'Rappeler [client_name]', title_en: 'Call [client_name] back' })], { langueEnvoi: 'en' });
    expect(carte('Créer une tâche')).toContain('Call [client_name] back');
  });

  it('l’interface en anglais d’un bureau qui envoie en FRANÇAIS montre le texte français (la langue de l’écran n’est pas celle des envois)', () => {
    monter(bilingue, { fr: false, langueEnvoi: 'fr' });
    expect(carte('Send a text')).toContain(FR);
  });
});

// ─── Triage « actions », 03-champs-types:177 ────────────────────

describe('03:177 — la carte résume le texte tel qu’il est écrit, « < » et « > » compris', () => {
  it('« Rabais si le total est < 500 $ ou > 1000 $ » : rien ne disparaît entre les deux signes', () => {
    const texte = 'Rabais si le total est < 500 $ ou > 1000 $';
    monter([action('send_sms', { body: texte })]);
    expect(carte('Envoyer un texto')).toContain(texte);
  });

  it('un courriel écrit en texte dans l’éditeur garde aussi ses signes', () => {
    monter([action('send_email', { subject: 'Objet', body: 'Total < 500 $ : 5 % ; total > 1000 $ : 10 %' })]);
    expect(carte('Envoyer un courriel')).toContain('Total < 500 $ : 5 % ; total > 1000 $ : 10 %');
  });

  it('un vrai corps HTML (courriel fourni) reste résumé en TEXTE, sans balise', () => {
    monter([action('send_email', { subject: 'Objet', body: '<div style="font-family:sans-serif;"><h2>Bonjour [client_first_name],</h2><p>Votre devis est prêt &amp; signé.</p></div>' })]);
    expect(carte('Envoyer un courriel')).toContain('Bonjour [client_first_name], Votre devis est prêt & signé.');
    expect(carte('Envoyer un courriel')).not.toMatch(/<div|<h2>|style=/);
  });

  it('un texte long est toujours coupé à 60 caractères, signes compris', () => {
    monter([action('send_sms', { body: `Rabais < 500 $ ${'x'.repeat(80)}` })]);
    expect(carte('Envoyer un texto')).toContain(`${`Rabais < 500 $ ${'x'.repeat(80)}`.slice(0, 60)}…`);
  });
});

// ─── Triage « actions », 03-champs-types:727 ────────────────────

describe('03:727 — la carte d’une action sans message dit ce qu’elle fera (quelle étiquette, quel membre, quelle adresse, quelle étape)', () => {
  const MEMBRE = '99999999-0000-4000-8000-000000000001';
  const ETAPE = 'eeeeeeee-0000-4000-8000-000000000001';
  const listes = {
    membres: [{ user_id: MEMBRE, nom: 'Tech QA' }],
    etapesPipeline: [{ id: ETAPE, label: 'Ventes · Négociation' }],
    automatisations: [{ id: 'aaaaaaaa-0000-4000-8000-000000000002', nom: 'Relance devis' }],
  };

  it('étiquette, membre, adresse du webhook, étape « Gagné »', () => {
    monter([
      action('ajouter_etiquette', { etiquette: 'VIP QA' }, 'e1', 'e2'),
      action('assigner_responsable', { membre_id: MEMBRE }, 'e2', 'e3'),
      action('webhook', { url: 'https://crochets.lume-qa.test/entrant?jeton=abc' }, 'e3', 'e4'),
      action('move_deal_stage', { cible: 'gagne' }, 'e4', null),
    ], listes);
    expect(carte('Ajouter une étiquette')).toContain('VIP QA');
    expect(carte('Assigner un responsable')).toContain('Tech QA');
    // L'hôte seulement : le chemin et ses jetons n'ont rien à faire sur une carte.
    expect(carte('Appeler un webhook')).toContain('crochets.lume-qa.test');
    expect(carte('Appeler un webhook')).not.toContain('jeton=abc');
    expect(carte('Déplacer l’opportunité')).toContain('Gagné');
  });

  it('une étape précise du pipeline, une automatisation démarrée : leur NOM, jamais leur identifiant', () => {
    monter([
      action('move_deal_stage', { cible: 'etape', stage_id: ETAPE }, 'e1', 'e2'),
      action('demarrer_automatisation', { rule_id: 'aaaaaaaa-0000-4000-8000-000000000002' }, 'e2', null),
    ], listes);
    expect(carte('Déplacer l’opportunité')).toContain('Ventes · Négociation');
    expect(carte('Démarrer une automatisation')).toContain('Relance devis');
    expect(conteneur.textContent).not.toContain(ETAPE);
  });

  it('un identifiant qu’on ne sait pas nommer (liste pas encore là, membre parti) n’est pas affiché brut', () => {
    monter([action('assigner_responsable', { membre_id: MEMBRE })]);
    expect(conteneur.textContent).not.toContain(MEMBRE);
  });

  it('un réglage CACHÉ ne s’affiche pas ; une case cochée se dit par son libellé', () => {
    monter([
      action('retirer_etiquette', { etiquette: 'VIP QA', toutes: 'true' }, 'e1', 'e2'),
      action('assigner_responsable', { membre_id: MEMBRE, seulement_si_vide: 'true' }, 'e2', null),
    ], listes);
    expect(carte('Retirer une étiquette')).not.toContain('VIP QA');
    expect(carte('Assigner un responsable')).toContain('Tech QA · Seulement si personne n’est assigné');
  });

  it('une action qui porte un message garde SON résumé (le texte), pas la liste de ses réglages', () => {
    monter([action('create_task', { title: 'Rappeler [client_name]', echeance_jours: '3' })]);
    expect(carte('Créer une tâche')).toContain('Rappeler [client_name]');
    expect(carte('Créer une tâche')).not.toContain('À faire dans');
  });

  it('en anglais : les options dans la langue de l’écran', () => {
    monter([action('move_deal_stage', { cible: 'gagne' })], { ...listes, fr: false });
    expect(carte('Move the deal')).toContain('The “Won” stage');
  });
});
