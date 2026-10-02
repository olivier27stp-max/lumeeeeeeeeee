// @vitest-environment jsdom
/**
 * L'ÉDITEUR DE COURRIEL D'UNE AUTOMATISATION — triage « modèles » du 2026-10-01,
 * fichier `04-courriel`. Le VRAI `EmailPreviewEditor` et la VRAIE API des
 * messages, sur une fausse base en mémoire : on fait le geste de l'utilisateur
 * et on regarde ce qui est écrit. Un bloc `describe` par ligne du triage.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';

const toasts = vi.hoisted(() => ({ succes: [] as string[], erreurs: [] as string[] }));
const confirmerMock = vi.hoisted(() => vi.fn(async (_o: unknown) => true));
const apercu = vi.hoisted(() => ({ appels: [] as unknown[][], essais: [] as unknown[][] }));

vi.mock('../../../src/lib/supabase', async () => (await import('./faux-supabase')).moduleSupabase());
vi.mock('../../../src/lib/orgApi', () => ({ getCurrentOrgId: async () => 'org-1', getCurrentOrgIdOrThrow: async () => 'org-1' }));
vi.mock('../../../server/lib/supabase', async () => (await import('./faux-supabase')).moduleSupabaseServeur());
vi.mock('../../../server/lib/automatisations-bureaux', () => ({ bureauxCibles: async () => [], copierVersBureaux: async () => [], propagerAuxCopies: async () => [] }));
vi.mock('../../../src/components/ui/ConfirmDialog', () => ({ confirmer: (o: unknown) => confirmerMock(o), default: () => null }));
vi.mock('../../../src/hooks/useChampsPersoActifs', () => ({ useChampsPersoActifs: () => ({ isEnabled: false, loading: false }) }));
vi.mock('../../../src/lib/champsPersoApi', () => ({ listerChamps: async () => ({ fields: [] }) }));
vi.mock('../../../src/lib/emailTemplatesApi', () => ({
  apercuCourriel: async (...a: unknown[]) => { apercu.appels.push(a); return '<p>aperçu</p>'; },
  envoyerEssaiCourriel: async (...a: unknown[]) => { apercu.essais.push(a); return 'proprio@lume-qa.test'; },
}));
vi.mock('sonner', () => {
  const toast = Object.assign((m: string) => { toasts.succes.push(m); }, {
    success: (m: string) => { toasts.succes.push(m); },
    error: (m: string) => { toasts.erreurs.push(m); },
    info: () => {},
  });
  return { toast };
});

import { base, remettre, ligne } from './faux-supabase';
import { monter, demonter, bouton, boutonPresent, champ, champs, cliquer, saisir, texteEcran, jusqua } from './banc-composants';
import { brancherServeur, arreterServeur } from './serveur-messages';
import EmailPreviewEditor from '../../../src/components/automations/EmailPreviewEditor';

type Action = { type: string; config: Record<string, unknown> };
type Regle = { id: string; actions: Action[]; steps: unknown[] | null };

const ENVELOPPE = '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">';
const P = (t: string) => `<p style="color:#333;line-height:1.6;">${t}</p>`;
const H2 = (t: string) => `<h2 style="color:#1a1a1a;font-size:18px;">${t}</h2>`;
const OBJET = 'Votre rendez-vous du [appointment_date]';
const CORPS = `${ENVELOPPE}${H2('Votre rendez-vous approche')}${P('Bonjour [client_first_name],')}${P('Merci, [company_name]')}</div>`;

function poser(actions: Action[], plus: Record<string, unknown> = {}): void {
  remettre({
    automation_rules: [{ id: 'r1', org_id: 'org-1', actions, steps: null, deleted_at: null, ...plus }],
    company_settings: [{ id: 'cs1', org_id: 'org-1', company_name: 'Nettoyage Test A', default_language: 'fr' }],
  });
}
const enBase = () => ligne<Regle>('automation_rules', 'r1');

/** Ouvre l'éditeur sur un courriel de la règle, comme « Modifier » dans la liste (qui passe le corps et l'objet français). */
async function ouvrir(config: Record<string, unknown>, props: Partial<React.ComponentProps<typeof EmailPreviewEditor>> = {}) {
  await monter(
    <EmailPreviewEditor
      ruleId="r1" ruleName="Rappel de rendez-vous" fr
      body={String(config.body ?? '')} subject={String(config.subject ?? '')}
      onClose={() => {}} onSaved={() => {}} declencheur="appointment.created"
      {...props}
    />,
  );
}
const objet = () => champ<HTMLInputElement>('Objet du courriel');

beforeEach(async () => {
  localStorage.setItem('lume-language', 'fr');
  toasts.succes.length = 0; toasts.erreurs.length = 0;
  apercu.appels.length = 0; apercu.essais.length = 0;
  confirmerMock.mockClear();
  await brancherServeur();
});
afterEach(async () => { await demonter(); });
afterAll(async () => { await arreterServeur(); });

describe('04-courriel:816 — modifier un courriel ne touche pas à l’autre courriel de la même automatisation', () => {
  it('changer l’objet du premier : le second garde son objet ET son corps', async () => {
    const c1 = { subject: OBJET, body: CORPS };
    const c2 = { subject: 'Second objet', body: `${ENVELOPPE}${H2('Second courriel')}${P('Texte du second.')}</div>` };
    poser([{ type: 'send_email', config: c1 }, { type: 'send_email', config: c2 }]);
    await ouvrir(c1);
    await saisir(objet(), 'Premier objet corrigé');
    await cliquer(bouton('Enregistrer'));
    await jusqua(() => toasts.succes.includes('Courriel enregistré'));
    expect(enBase().actions[0].config.subject).toBe('Premier objet corrigé');
    expect(enBase().actions[1].config).toEqual(c2);
  });

  it('ouvert sur le SECOND : c’est lui qui change, pas le premier', async () => {
    const c1 = { subject: OBJET, body: CORPS };
    const c2 = { subject: 'Second objet', body: `${ENVELOPPE}${H2('Second courriel')}${P('Texte du second.')}</div>` };
    poser([{ type: 'send_email', config: c1 }, { type: 'send_email', config: c2 }]);
    await ouvrir(c2);
    await saisir(objet(), 'Second objet corrigé');
    await cliquer(bouton('Enregistrer'));
    await jusqua(() => toasts.succes.includes('Courriel enregistré'));
    expect(enBase().actions[0].config).toEqual(c1);
    expect(enBase().actions[1].config.subject).toBe('Second objet corrigé');
  });

  it('deux enregistrements de suite sans que la liste ait rechargé : le second vise toujours le même courriel', async () => {
    const c1 = { subject: OBJET, body: CORPS };
    const c2 = { subject: 'Second objet', body: `${ENVELOPPE}${H2('Second courriel')}</div>` };
    poser([{ type: 'send_email', config: c1 }, { type: 'send_email', config: c2 }]);
    await ouvrir(c1);
    await saisir(objet(), 'Objet, première correction');
    await cliquer(bouton('Enregistrer'));
    await jusqua(() => toasts.succes.length === 1);
    await saisir(objet(), 'Objet, seconde correction');
    await cliquer(bouton('Enregistrer'));
    await jusqua(() => toasts.succes.length === 2);
    expect(toasts.erreurs).toEqual([]);
    expect(enBase().actions[0].config.subject).toBe('Objet, seconde correction');
    expect(enBase().actions[1].config).toEqual(c2);
  });
});

describe('04-courriel:260 — après « Enregistrer », l’éditeur dit que c’est enregistré', () => {
  it('la fenêtre affiche « Aucune modification » et « Enregistrer » se grise, sans attendre le rechargement de la liste', async () => {
    const c1 = { subject: OBJET, body: CORPS };
    poser([{ type: 'send_email', config: c1 }]);
    const fermetures: number[] = [];
    await ouvrir(c1, { onClose: () => { fermetures.push(1); } });
    await saisir(objet(), 'Nouvel objet');
    expect(texteEcran()).toContain('Modifications non enregistrées');
    await cliquer(bouton('Enregistrer'));
    await jusqua(() => toasts.succes.includes('Courriel enregistré'));
    expect(enBase().actions[0].config.subject).toBe('Nouvel objet');
    // Personne n'a cliqué « Fermer » : l'éditeur ne se ferme pas de lui-même.
    expect(fermetures).toEqual([]);
    expect(texteEcran()).toContain('Aucune modification');
    expect(bouton('Enregistrer').disabled).toBe(true);
  });
});

describe('04-courriel:394 et :410 — ce qu’on n’a pas touché garde sa mise en forme', () => {
  const corpsEnBase = () => String(enBase().actions[0].config.body);
  const paragraphe = (rang: number) => champs('Paragraphe')[rang];

  it('corriger un mot d’un paragraphe ne détruit ni le lien « Voir votre soumission » ni le gras d’un autre paragraphe', async () => {
    const corps = `${ENVELOPPE}${H2('Bonjour [client_first_name],')}${P('On vous a envoyé une soumission hier.')}${P('<strong>Offre valable 30 jours.</strong>')}<p style="color:#333;line-height:1.6;"><a href="[quote_link]">Voir votre soumission</a></p>${P('Merci, [company_name]')}</div>`;
    const c = { subject: 'Votre soumission', body: corps };
    poser([{ type: 'send_email', config: c }]);
    await ouvrir(c);
    await saisir(paragraphe(0), 'On vous a envoyé une soumission avant-hier.');
    await cliquer(bouton('Enregistrer'));
    await jusqua(() => toasts.succes.includes('Courriel enregistré'));
    // Seul le paragraphe corrigé a changé : le reste est le HTML d'origine, au caractère près.
    expect(corpsEnBase()).toBe(corps.replace('soumission hier.', 'soumission avant-hier.'));
    expect(corpsEnBase()).toContain('<a href="[quote_link]">Voir votre soumission</a>');
    expect(corpsEnBase()).toContain('<strong>Offre valable 30 jours.</strong>');
  });

  it('un courriel qui commence par un paragraphe : ce paragraphe ne devient pas un titre', async () => {
    const c = { subject: 'Votre facture', body: `${ENVELOPPE}${P('Bonjour [client_first_name],')}${P('Votre facture est prête.')}</div>` };
    poser([{ type: 'send_email', config: c }]);
    await ouvrir(c);
    expect(champs('Titre')).toHaveLength(0);
    await saisir(paragraphe(1), 'Votre facture est prête, merci!');
    await cliquer(bouton('Enregistrer'));
    await jusqua(() => toasts.succes.includes('Courriel enregistré'));
    expect(corpsEnBase()).toBe(`${ENVELOPPE}${P('Bonjour [client_first_name],')}${P('Votre facture est prête, merci!')}</div>`);
    expect(corpsEnBase()).not.toMatch(/<h2[^>]*>Bonjour/);
  });

  it('un bloc réécrit est reconstruit dans SON type, avec les styles du générateur ; les puces qui se suivent partagent une liste', async () => {
    const c = { subject: 'Objet', body: `${ENVELOPPE}${H2('Titre')}${P('Ligne A')}<ul style="padding-left:18px;line-height:1.6;"><li>Un</li><li><strong>Deux</strong></li></ul></div>` };
    poser([{ type: 'send_email', config: c }]);
    await ouvrir(c);
    await saisir(champs('Titre')[0], 'Titre <corrigé> & co');
    await saisir(champs('Puce')[0], 'Un, corrigé');
    await cliquer(bouton('Puce'));
    await saisir(champs('Puce')[2], 'Trois');
    await cliquer(bouton('Enregistrer'));
    await jusqua(() => toasts.succes.includes('Courriel enregistré'));
    expect(corpsEnBase()).toBe(
      `${ENVELOPPE}${H2('Titre &lt;corrigé&gt; &amp; co')}${P('Ligne A')}<ul style="padding-left:18px;line-height:1.6;"><li>Un, corrigé</li><li><strong>Deux</strong></li><li>Trois</li></ul></div>`,
    );
  });

  it('un texte remis comme il était retrouve sa mise en forme d’origine, et « Enregistrer » se grise', async () => {
    const c = { subject: 'Objet', body: `${ENVELOPPE}${H2('Titre')}${P('<strong>Offre valable 30 jours.</strong>')}</div>` };
    poser([{ type: 'send_email', config: c }]);
    await ouvrir(c);
    await saisir(paragraphe(0), 'Offre valable 60 jours.');
    expect(bouton('Enregistrer').disabled).toBe(false);
    await saisir(paragraphe(0), 'Offre valable 30 jours.');
    expect(bouton('Enregistrer').disabled).toBe(true);
    expect(texteEcran()).toContain('Aucune modification');
  });

  it('l’aperçu réel reçoit ce qui sera enregistré : le lien et le gras y sont', async () => {
    const corps = `${ENVELOPPE}${H2('Bonjour,')}${P('<strong>Offre valable 30 jours.</strong>')}<p><a href="[quote_link]">Voir votre soumission</a></p></div>`;
    const c = { subject: 'Objet', body: corps };
    poser([{ type: 'send_email', config: c }]);
    await ouvrir(c);
    await cliquer(bouton('Aperçu réel'));
    await jusqua(() => apercu.appels.length > 0);
    expect(apercu.appels.at(-1)?.[0]).toBe(corps);
  });

  it('un courriel écrit en texte brut (sans balises) : une ligne = un paragraphe, aucune promue en titre', async () => {
    const c = { subject: 'Objet', body: 'Bonjour Marie,\n\nVotre facture est prête.\nMerci!' };
    poser([{ type: 'send_email', config: c }]);
    await ouvrir(c);
    expect(champs('Titre')).toHaveLength(0);
    expect(champs('Paragraphe').map((p) => p.value)).toEqual(['Bonjour Marie,', 'Votre facture est prête.', 'Merci!']);
    await saisir(paragraphe(2), 'Merci beaucoup!');
    await cliquer(bouton('Enregistrer'));
    await jusqua(() => toasts.succes.includes('Courriel enregistré'));
    expect(corpsEnBase()).toBe(`${ENVELOPPE}${P('Bonjour Marie,')}${P('Votre facture est prête.')}${P('Merci beaucoup!')}</div>`);
  });
});

describe('04-courriel:538 et :547 — « Insérer » écrit là où est le curseur', () => {
  const C = { subject: 'Objet', body: `${ENVELOPPE}${H2('Titre')}${P('Bonjour , à demain.')}${P('Dernière ligne')}</div>` };
  /** Met le curseur dans un champ, comme un clic puis une flèche. */
  async function curseur(el: HTMLInputElement | HTMLTextAreaElement, position: number) {
    await saisir(el, el.value); // lui donne le focus, sans changer son texte
    el.setSelectionRange(position, position);
  }

  it('dans une ligne : la variable va au curseur, pas en fin de ligne', async () => {
    poser([{ type: 'send_email', config: C }]);
    await ouvrir(C);
    const ligne = champs('Paragraphe')[0];
    await curseur(ligne, 8);
    await cliquer(bouton('Prénom du client'));
    expect(ligne.value).toBe('Bonjour [client_first_name], à demain.');
    // Le curseur reste juste après la variable : une seconde insertion s'enchaîne.
    expect(ligne.selectionStart).toBe(8 + '[client_first_name]'.length);
    await cliquer(bouton('Nom complet'));
    expect(ligne.value).toBe('Bonjour [client_first_name][client_name], à demain.');
    // Les autres lignes et l'objet n'ont rien reçu.
    expect(champs('Paragraphe')[1].value).toBe('Dernière ligne');
    expect(objet().value).toBe('Objet');
  });

  it('dans l’objet : au curseur aussi ; un texte sélectionné est remplacé', async () => {
    poser([{ type: 'send_email', config: { ...C, subject: 'Rappel pour XXX demain' } }]);
    await ouvrir({ ...C, subject: 'Rappel pour XXX demain' });
    await saisir(objet(), objet().value);
    objet().setSelectionRange(12, 15);
    await cliquer(bouton('Prénom du client'));
    expect(objet().value).toBe('Rappel pour [client_first_name] demain');
  });

  it('sans champ cliqué : à la fin de la dernière ligne, comme avant', async () => {
    poser([{ type: 'send_email', config: C }]);
    await ouvrir(C);
    await cliquer(bouton('Prénom du client'));
    expect(champs('Paragraphe')[1].value).toBe('Dernière ligne[client_first_name]');
    expect(objet().value).toBe('Objet');
  });

  it('courriel vidé de toutes ses lignes : la variable ouvre une ligne, au lieu d’un clic sans effet', async () => {
    const seule = { subject: 'Objet', body: `${ENVELOPPE}${H2('Seule ligne')}</div>` };
    poser([{ type: 'send_email', config: seule }]);
    await ouvrir(seule);
    await cliquer(bouton('Supprimer cette ligne'));
    expect(champs('Titre').length + champs('Paragraphe').length).toBe(0);
    await cliquer(bouton('Prénom du client'));
    expect(champs('Paragraphe').map((p) => p.value)).toEqual(['[client_first_name]']);
  });
});

describe('04-courriel:560 et :588 — sur « Aperçu réel » : pas de palette, et « M’envoyer un essai » sous la main', () => {
  const C = { subject: OBJET, body: CORPS };
  const palette = () => document.body.querySelector('[data-testid="palette-variables"]');

  it('la palette « Insérer » n’est offerte que sur « Modifier » : regarder l’aperçu ne modifie rien', async () => {
    poser([{ type: 'send_email', config: C }]);
    await ouvrir(C);
    expect(palette()).not.toBeNull();
    await cliquer(bouton('Aperçu réel'));
    expect(palette()).toBeNull();
    expect(boutonPresent('Prénom du client')).toBe(false);
    expect(document.body.querySelector('input[type="search"]')).toBeNull();
    expect(texteEcran()).toContain('Aucune modification');
    // De retour sur « Modifier », elle est là, et rien n'a été touché.
    await cliquer(bouton('Modifier'));
    expect(palette()).not.toBeNull();
    expect(texteEcran()).toContain('Aucune modification');
  });

  it('« M’envoyer un essai » est dans le pied de la fenêtre, à côté de « Enregistrer » — pas sous le cadre de l’aperçu', async () => {
    poser([{ type: 'send_email', config: C }]);
    await ouvrir(C);
    expect(boutonPresent('M’envoyer un essai')).toBe(false);
    await cliquer(bouton('Aperçu réel'));
    await jusqua(() => apercu.appels.length > 0);
    const essai = bouton('M’envoyer un essai');
    expect(essai.parentElement).toBe(bouton('Enregistrer').parentElement);
    await cliquer(essai);
    await jusqua(() => toasts.succes.includes('Essai envoyé à proprio@lume-qa.test'));
    expect(apercu.essais).toHaveLength(1);
  });
});

describe('04-courriel:834 — bureau qui écrit en ANGLAIS à ses clients : l’éditeur montre et modifie le courriel qui part', () => {
  const FR = { subject: 'Votre rendez-vous', body: `${ENVELOPPE}${H2('Bonjour,')}${P('À demain.')}</div>` };
  const EN = { subject_en: 'Your appointment', body_en: `${ENVELOPPE}${H2('Hello,')}${P('See you tomorrow.')}</div>` };
  const langueDuBureau = (l: 'fr' | 'en') => { base.tables.company_settings[0].default_language = l; };
  const version = (nom: string) => Array.from(document.body.querySelectorAll('button')).find((b) => (b.textContent ?? '').startsWith(nom));
  const paragraphes = () => champs('Paragraphe').map((c) => c.value);
  const config = () => enBase().actions[0].config;
  const objetPret = () => jusqua(() => champs<HTMLInputElement>('Objet du courriel').length === 1);

  it('bureau en anglais : l’éditeur s’ouvre sur la version anglaise, dit que c’est elle qui part, et « Enregistrer » écrit `subject_en`', async () => {
    poser([{ type: 'send_email', config: { ...FR, ...EN } }]);
    langueDuBureau('en');
    await ouvrir(FR);
    await objetPret();
    expect(objet().value).toBe('Your appointment');
    expect(paragraphes()).toEqual(['See you tomorrow.']);
    expect(version('Version anglaise')?.getAttribute('aria-pressed')).toBe('true');
    expect(version('Version anglaise')?.textContent).toContain('celle qui part');
    expect(texteEcran()).toContain('Vos clients reçoivent la version anglaise');
    await saisir(objet(), 'Your appointment tomorrow');
    await cliquer(bouton('Enregistrer'));
    await jusqua(() => toasts.succes.includes('Courriel enregistré'));
    expect(config()).toEqual({ ...FR, ...EN, subject_en: 'Your appointment tomorrow' });
  });

  it('la version française reste visible et modifiable, à un clic', async () => {
    poser([{ type: 'send_email', config: { ...FR, ...EN } }]);
    langueDuBureau('en');
    await ouvrir(FR);
    await objetPret();
    await cliquer(version('Version française'));
    expect(objet().value).toBe('Votre rendez-vous');
    expect(paragraphes()).toEqual(['À demain.']);
    // Revenir à l'anglais ne perd rien de ce qu'on a tapé en français.
    await saisir(objet(), 'Votre rendez-vous de demain');
    await cliquer(version('Version anglaise'));
    expect(objet().value).toBe('Your appointment');
    await cliquer(version('Version française'));
    expect(objet().value).toBe('Votre rendez-vous de demain');
  });

  it('bureau en français, courriel qui porte une version anglaise : corriger le français sans l’anglais est signalé, et « Enregistrer » attend', async () => {
    poser([{ type: 'send_email', config: { ...FR, ...EN } }]);
    await ouvrir(FR);
    await objetPret();
    expect(version('Version française')?.getAttribute('aria-pressed')).toBe('true');
    expect(version('Version française')?.textContent).toContain('celle qui part');
    expect(objet().value).toBe('Votre rendez-vous');
    await saisir(objet(), 'Votre rendez-vous de jeudi');
    expect(texteEcran()).toContain('Le texte français a changé, pas sa version anglaise.');
    expect(bouton('Enregistrer').disabled).toBe(true);
    // « La version anglaise reste valable telle quelle » : on peut enregistrer, et l'anglais ne bouge pas.
    await cliquer(document.body.querySelector('input[type="checkbox"]'));
    expect(bouton('Enregistrer').disabled).toBe(false);
    await cliquer(bouton('Enregistrer'));
    await jusqua(() => toasts.succes.includes('Courriel enregistré'));
    expect(config()).toEqual({ ...FR, ...EN, subject: 'Votre rendez-vous de jeudi' });
    expect(texteEcran()).not.toContain('Le texte français a changé');
  });

  it('les deux versions corrigées : une seule écriture, les deux en base', async () => {
    poser([{ type: 'send_email', config: { ...FR, ...EN } }]);
    await ouvrir(FR);
    await objetPret();
    await saisir(objet(), 'Votre rendez-vous de jeudi');
    await cliquer(version('Version anglaise'));
    await saisir(objet(), 'Your Thursday appointment');
    expect(texteEcran()).not.toContain('Le texte français a changé');
    await cliquer(bouton('Enregistrer'));
    await jusqua(() => toasts.succes.includes('Courriel enregistré'));
    expect(base.ecritures).toHaveLength(1);
    expect(config()).toMatchObject({ subject: 'Votre rendez-vous de jeudi', subject_en: 'Your Thursday appointment' });
    expect(texteEcran()).toContain('Aucune modification');
  });

  it('la version anglaise vidée est retirée de la règle : le français part à tout le monde', async () => {
    poser([{ type: 'send_email', config: { ...FR, ...EN } }]);
    langueDuBureau('en');
    await ouvrir(FR);
    await objetPret();
    await saisir(objet(), '');
    while (boutonPresent('Supprimer cette ligne')) await cliquer(bouton('Supprimer cette ligne'));
    await cliquer(bouton('Enregistrer'));
    await jusqua(() => toasts.succes.includes('Courriel enregistré'));
    expect(config()).toEqual(FR);
    // Il ne reste que le français, et l'écran dit que c'est lui qui part.
    expect(objet().value).toBe('Votre rendez-vous');
    expect(version('Version anglaise')).toBeUndefined();
    expect(texteEcran()).toContain('ce courriel n’a pas de version anglaise');
  });

  it('bureau en anglais, courriel SANS version anglaise : l’écran dit que c’est le texte français qui part', async () => {
    poser([{ type: 'send_email', config: FR }]);
    langueDuBureau('en');
    await ouvrir(FR);
    await objetPret();
    expect(objet().value).toBe('Votre rendez-vous');
    expect(texteEcran()).toContain('La langue des messages du bureau est l’anglais, mais ce courriel n’a pas de version anglaise : c’est ce texte français qui part.');
  });

  it('bureau en français, courriel sans version anglaise : rien de plus à l’écran', async () => {
    poser([{ type: 'send_email', config: FR }]);
    await ouvrir(FR);
    await objetPret();
    expect(version('Version française')).toBeUndefined();
    expect(texteEcran()).not.toContain('version anglaise');
  });

  it('langue du bureau illisible : aucune version n’est dite « celle qui part »', async () => {
    poser([{ type: 'send_email', config: { ...FR, ...EN } }]);
    base.erreursLectureParTable.company_settings = { message: 'panne simulée' };
    const journal = vi.spyOn(console, 'error').mockImplementation(() => {});
    await ouvrir(FR);
    await objetPret();
    expect(texteEcran()).not.toContain('celle qui part');
    expect(texteEcran()).toContain('Impossible de lire la langue des messages du bureau pour le moment');
    journal.mockRestore();
  });

  it('interface anglaise : les mêmes repères, en anglais', async () => {
    localStorage.setItem('lume-language', 'en');
    poser([{ type: 'send_email', config: { ...FR, ...EN } }]);
    await ouvrir(FR, { fr: false });
    await jusqua(() => champs<HTMLInputElement>('Email subject').length === 1);
    await saisir(champ<HTMLInputElement>('Email subject'), 'Votre rendez-vous de jeudi');
    expect(texteEcran()).toContain('The French text changed, not its English version.');
    expect(texteEcran()).toContain('The English version still holds as is');
    expect(version('French version')?.textContent).toContain('the one sent');
  });
});
