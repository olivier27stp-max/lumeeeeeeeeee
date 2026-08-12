/**
 * Lot 5 du chantier automatisations — voir et modifier ce qui part.
 *
 * 35 automatisations écrivent aux clients au nom de l'entreprise, et la page
 * Automatisations n'affichait que le TYPE d'action (« Envoyer un courriel »).
 * L'utilisateur ne pouvait ni relire ni corriger ce texte : les SMS n'étaient
 * modifiables que depuis Réglages → Messagerie, sans aucun lien depuis cette
 * page, et les courriels nulle part.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..', '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

describe('API — les deux canaux sont modifiables', () => {
  const api = read('src/lib/automationRulesApi.ts');

  it('une seule fonction couvre SMS et courriel', () => {
    // `updateRuleSmsBody` ne gérait que les SMS : le corps des courriels
    // n'était modifiable nulle part dans le produit.
    expect(api).toContain('export async function updateRuleMessage');
    expect(api).toContain("actionType: 'send_sms' | 'send_email'");
  });

  it('l’objet n’est écrit que pour un courriel', () => {
    // Un SMS n'a pas de sujet : l'écrire polluerait sa configuration.
    expect(api).toContain("actionType === 'send_email' && subject !== undefined");
  });

  it('seule l’action visée est modifiée', () => {
    // Une règle porte souvent SMS + courriel : modifier l'un ne doit pas
    // écraser l'autre.
    expect(api).toContain('a.type === actionType');
  });

  it('une écriture filtrée par la RLS lève au lieu de faire semblant', () => {
    // Sans `.select()`, PostgREST renvoie un succès pour 0 ligne touchée :
    // l'utilisateur croirait avoir enregistré son texte.
    const fn = api.slice(
      api.indexOf('export async function updateRuleMessage'),
      api.indexOf('@deprecated'),
    );
    expect(fn).toContain(".select('id')");
    expect(fn).toContain('!updated || updated.length === 0');
    expect(fn).toContain('Modification refusée');
  });

  it('l’ancienne fonction reste, marquée obsolète', () => {
    // Un autre écran l'utilise encore (Réglages → Messagerie) : la retirer
    // d'un coup casserait cette page.
    expect(api).toContain('@deprecated');
    expect(api).toContain('export async function updateRuleSmsBody');
  });
});

describe('éditeur — ce que l’utilisateur voit et fait', () => {
  const editeur = read('src/components/automations/MessageEditor.tsx');
  const page = read('src/pages/Automations.tsx');

  it('l’éditeur est branché dans le panneau de la règle', () => {
    expect(page).toContain('import MessageEditor');
    expect(page).toContain('<MessageEditor');
    expect(page).toContain("a.type === 'send_sms' || a.type === 'send_email'");
  });

  it('le courriel expose son objet, pas le SMS', () => {
    expect(editeur).toContain('estCourriel && (');
    expect(editeur).toContain("actionType === 'send_email'");
  });

  it('le compteur de caractères prévient du coût d’un SMS long', () => {
    // Twilio facture par tranche de 160 caractères : sans compteur, un texte
    // rallongé double la facture sans que personne ne le voie.
    expect(editeur).toContain('texte.length');
    expect(editeur).toContain('Math.ceil(texte.length / 160)');
  });

  it('les variables du moteur sont proposées', () => {
    // Elles doivent correspondre à ce que `resolveEntityVariables` fournit
    // réellement, sinon l'utilisateur insère un trou dans son message.
    expect(editeur).toContain('client_first_name');
    expect(editeur).toContain('company_name');
    expect(editeur).toContain('invoice_number');
    expect(editeur).toContain('quote_number');
    expect(editeur).toContain('appointment_date');
  });

  it('le bouton reste inerte tant que rien n’a changé', () => {
    expect(editeur).toContain('const modifie =');
    expect(editeur).toContain('disabled={!modifie || enregistrement}');
  });

  it('un échec d’enregistrement est signalé, pas avalé', () => {
    expect(editeur).toContain('toast.error');
    expect(editeur).toContain('toast.success');
  });

  it('cliquer dans l’éditeur ne referme pas le panneau', () => {
    // La ligne entière bascule le panneau au clic : sans cette barrière,
    // taper dans le champ le refermerait.
    expect(editeur).toContain('onClick={(e) => e.stopPropagation()}');
  });

  it('la page reste protégée en écriture', () => {
    // Non-régression : l'édition ne doit pas contourner la permission.
    expect(page).toContain('<PermissionGate permission="automations.update">');
  });
});

describe('variables proposées — cohérence avec le moteur', () => {
  it('chaque variable proposée est réellement fournie par le résolveur', () => {
    // Proposer une variable que le moteur ne remplit pas insérerait un trou
    // dans le message envoyé au client — `resolveTemplate` remplace une
    // variable inconnue par une chaîne vide.
    const editeur = read('src/components/automations/MessageEditor.tsx');
    const actions = read('server/lib/actions/index.ts');
    const bloc = editeur.slice(editeur.indexOf('const VARIABLES'), editeur.indexOf('];', editeur.indexOf('const VARIABLES')));
    const proposees = [...bloc.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(proposees.length).toBeGreaterThan(5);
    for (const v of proposees) {
      expect(actions, `variable proposée mais jamais résolue : ${v}`).toContain(`vars.${v}`);
    }
  });
});
