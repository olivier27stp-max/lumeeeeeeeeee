/**
 * QA DU 2026-09-25 — les derniers points P2, et la demande d'avis.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { construireMessages } from '../server/lib/lumi/generer-parcours';

const lire = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('P2-6 — « Réécris le premier texto » ne rend plus une erreur générique', () => {
  const gen = lire('server/lib/lumi/generer-parcours.ts');

  it('le parcours à l’écran est envoyé avec la demande', () => {
    /*
     * La vraie cause : sans le parcours, le modèle n'avait aucun texto à
     * réécrire. Vérifié contre le vrai modèle le 2026-09-25 : AVEC le
     * parcours, 3 essais sur 3 ne changent que le premier texto.
     */
    const msgs = construireMessages('Réécris le premier texto', undefined, {
      trigger_event: 'quote.sent',
      steps: [{ id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'Yo' } } }],
    });
    expect(msgs.length).toBe(2);
    expect(msgs[0].content).toContain('parcours ACTUEL');
    expect(msgs[1].content).toBe('Réécris le premier texto');
  });

  it('une réponse sans JSON rend un message CLAIR, pas « Lumi n’a pas pu répondre »', () => {
    // Et jamais la phrase brute du modèle : mesuré, il y parle de « JSON »
    // une fois sur deux — du jargon pour un plombier.
    expect(gen).toMatch(/Il n\u2019y a pas encore de parcours \u00e0 modifier|Il n’y a pas encore de parcours à modifier/);
    expect(gen).toMatch(/pas compris cette modification/);
  });

  it('un déclencheur oublié en modifiant est repris du parcours courant', () => {
    expect(gen).toMatch(/brut\.trigger_event = parcoursActuel\.trigger_event/);
  });
});

describe('P2-13 — quitter l’éditeur ne perd rien', () => {
  const ed = lire('src/pages/AutomationBuilderPage.tsx');

  it('des étapes complètes sont ENREGISTRÉES avant de partir', () => {
    // « Avertir ou garantir la sauvegarde dans tous les cas » : on garantit.
    const i = ed.indexOf('const quitterEditeur');
    const bloc = ed.slice(i, i + 2500);
    expect(bloc).toMatch(/await modifierAutomatisation\(regle\.id/);
  });

  it('« en cours d’enregistrement » compte aussi comme travail non enregistré', () => {
    // Fermer l'onglet pendant l'envoi peut couper la requête.
    expect(ed).toMatch(/etatSauvegarde === 'en_cours';/);
  });
});

describe('P2-2 — la liste montre le vrai parcours, pas un texto fantôme', () => {
  const liste = lire('src/pages/Automations.tsx');

  it('une règle bâtie dans l’éditeur affiche les messages de SES étapes', () => {
    /*
     * Créée de zéro, une règle reçoit « À compléter » dans l'ancien format.
     * La liste lisait l'ancien format et affichait ce texto pour une
     * automatisation qui n'envoie qu'un courriel.
     */
    expect(liste).toMatch(/Array\.isArray\(rule\.steps\) && rule\.steps\.length > 0 \? \(/);
    expect(liste).toMatch(/Courriel envoyé au client/);
  });

  it('en lecture seule — une modification faite là serait ignorée par le moteur', () => {
    expect(liste).toMatch(/Modifier dans l’éditeur/);
  });
});

describe('P2-9 — la pause se voit sur chaque ligne', () => {
  const liste = lire('src/pages/Automations.tsx');
  it('une règle publiée affiche « en pause » pendant « Tout arrêter »', () => {
    expect(liste).toMatch(/rule\.is_active && toutEnPause \? \(fr \? 'Publiée · en pause'/);
    expect(liste).toMatch(/<BandeauPause fr=\{fr\} onChange=\{setToutEnPause\} \/>/);
  });
});

describe('P2-10 — le coût d’une génération Lumi est montré', () => {
  it('le serveur le renvoie et l’écran l’affiche', () => {
    expect(lire('server/routes/automation-rules.ts')).toMatch(/cout_cents: resultat\.coutCents \?\? null/);
    expect(lire('src/pages/AutomationBuilderPage.tsx')).toMatch(/de ton budget Lumi/);
  });

  it('jamais « 0 ¢ » — ça ferait croire que c’est gratuit', () => {
    expect(lire('src/pages/AutomationBuilderPage.tsx')).toMatch(/Math\.max\(0\.1,/);
  });
});

describe('Demande d’avis — une règle morte doit se VOIR', () => {
  const liste = lire('src/pages/Automations.tsx');

  it('l’avertissement apparaît quand les avis sont désactivés', () => {
    /*
     * `review_enabled` vaut FAUX par défaut, le préréglage d'avis est actif
     * par défaut. Mesuré en prod : 6 entreprises sur 7 avec une règle d'avis
     * « Publiée » qui échouait à chaque fois, sans rien pour le signaler.
     */
    expect(liste).toMatch(/avisOk === false && rule\.is_active && !rule\.deleted_at && demandeUnAvis\(rule\)/);
  });

  it('il nomme le VRAI chemin du réglage', () => {
    // Le libellé du menu Paramètres est « Avis clients ».
    expect(lire('src/pages/settings/SettingsLayout.tsx')).toMatch(/isFr \? 'Avis clients'/);
    expect(liste).toMatch(/Param\u00e8tres \u203a Avis clients|Paramètres › Avis clients/);
  });

  it('un réglage illisible n’affiche PAS d’avertissement (pas de faux signal)', () => {
    expect(liste).toMatch(/avisOk === false/);
    expect(lire('src/lib/automationRulesApi.ts')).toMatch(/return null;\s*\n\s*\}\s*\n\s*return data\?\.review_enabled === true;/);
  });
});
