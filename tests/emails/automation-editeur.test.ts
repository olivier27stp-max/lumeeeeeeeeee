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

  /* 2026-10-01 : l'écriture d'un message ne part plus du navigateur vers la
     table — elle passe par `PATCH /api/automations/rules/:id/messages`. Les
     deux règles ci-dessous sont donc tenues par le SERVEUR ; on les y vérifie,
     et on vérifie que le navigateur n'écrit plus la table lui-même. Le
     comportement est prouvé par tests/automations-finale/t/messages-route.test.ts. */
  const route = read('server/routes/automation-messages.ts');
  const logique = read('server/lib/automation-messages.ts');

  it('seule l’action visée est modifiée', () => {
    // Une règle porte souvent SMS + courriel — ou DEUX textos : modifier l'un
    // ne doit pas écraser l'autre. On écrit l'action désignée, par son index.
    expect(logique).toContain('i === vise.indexAction');
    expect(logique).toContain('e.id === vise.etapeId');
  });

  it('une écriture filtrée par la RLS lève au lieu de faire semblant', () => {
    // Sans `.select()`, PostgREST renvoie un succès pour 0 ligne touchée :
    // l'utilisateur croirait avoir enregistré son texte.
    expect(route).toContain(".select('id')");
    expect(route).toContain('!ecrites || ecrites.length === 0');
    expect(route).toContain('Modification refusée');
    // Et le navigateur relaie le refus du serveur au lieu d'annoncer un succès.
    const fn = api.slice(api.indexOf('export async function ecrireMessageDeRegle'), api.indexOf('export function texteDuMessage'));
    expect(fn).toContain('if (!reponse.ok)');
    expect(fn).toContain('messageDuServeur(rendu)');
  });

  it('le navigateur n’écrit plus la table des automatisations lui-même', () => {
    expect(api).not.toMatch(/\.from\('automation_rules'\)\s*\.(update|insert|delete|upsert)\(/);
    expect(api).toContain('`/api/automations/rules/${id}/messages`');
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

  it('le courriel s’ouvre dans son propre éditeur, le SMS s’édite en place', () => {
    // Éditer un courriel dans la bande étroite du panneau obligeait à taper
    // dans un champ minuscule ; il s'ouvre donc en pleine page.
    expect(editeur).toContain("actionType === 'send_email'");
    expect(editeur).toContain('EmailPreviewEditor');
    expect(editeur).toContain('setEditeurOuvert');
    // L'objet est édité dans cette fenêtre, pas dans le panneau.
    expect(read('src/components/automations/EmailPreviewEditor.tsx')).toContain('setObjet');
  });

  it('le compteur de caractères prévient du coût d’un SMS long', () => {
    // Twilio facture par segment : sans compteur, un texte rallongé double la
    // facture sans que personne ne le voie. Le calcul vit dans lib/smsSegments
    // (160 puis 153 en GSM-7, 70 puis 67 dès un « ê » ou un émoji) : diviser
    // par 160 dans l'éditeur annonçait « 2 SMS » pour un texte facturé 3.
    expect(editeur).toContain('texte.length');
    expect(editeur).toContain('libelleSegments(texte, fr)');
    expect(editeur).not.toContain('/ 160');
  });

  it('les variables viennent d’une source unique', () => {
    // Dupliquée dans chaque éditeur, la liste finissait par diverger entre le
    // SMS et le courriel : ajouter une variable obligeait à penser aux deux.
    expect(editeur).toContain('VARIABLES_PROPOSEES');
    expect(read('src/lib/emailBodyText.ts')).toContain('export const VARIABLES_PROPOSEES');
  });

  it('le bouton reste inerte tant que rien n’a changé', () => {
    expect(editeur).toContain('const modifie =');
    // … ni quand le texte est vide (A-06, vague 4) : un texto vide partirait vide.
    expect(editeur).toContain('disabled={!modifie || vide || enregistrement}');
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
    // variable inconnue par une chaîne vide. (Vérifié aussi dans
    // email-body-text.test.ts, sur la liste elle-même.)
    const lib = read('src/lib/emailBodyText.ts');
    const actions = read('server/lib/actions/index.ts');
    const bloc = lib.slice(lib.indexOf('VARIABLES_PROPOSEES'));
    const proposees = [...bloc.matchAll(/cle: '([a-z_]+)'/g)].map((m) => m[1]);
    expect(proposees.length).toBeGreaterThan(5);
    for (const v of proposees) {
      expect(actions, `variable proposée mais jamais résolue : ${v}`).toContain(`vars.${v}`);
    }
  });
});
