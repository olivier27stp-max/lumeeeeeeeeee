/**
 * Changer de déclencheur n'emporte pas les réglages de l'ancien.
 *
 * Audit du 2026-10-01 (constat bloquant, observé à l'écran et en base) : les
 * réglages d'un déclencheur vivent dans `conditions`. L'éditeur les FUSIONNAIT
 * au changement : passer par « Devis ouvert par le client » (qui pose d'office
 * « première ouverture seulement ») puis choisir « Étiquette ajoutée » laissait
 * `{ ouverture: 'premiere' }` en base, invisible à l'écran. Le moteur compare
 * chaque clé aux métadonnées de l'événement : une étiquette ajoutée n'a pas
 * d'« ouverture », la règle ne part donc jamais — publiée, sans un mot.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DECLENCHEURS, conditionsApresChangement } from '../src/lib/automationCatalogue';

const racine = resolve(__dirname, '..');

describe('conditionsApresChangement', () => {
  it('le cas observé : « Devis ouvert » → « Étiquette ajoutée », la « première ouverture » ne suit pas', () => {
    expect(conditionsApresChangement('quote.viewed', 'client.tagged', { ouverture: 'premiere' })).toEqual({});
  });

  it('« Date atteinte » réglée → « Devis envoyé » : ni le champ date ni les jours ne restent', () => {
    expect(conditionsApresChangement('date.reached', 'quote.sent', { champ_id: 'abc', jours_avant: 3 })).toEqual({});
  });

  it('les réglages d’office du NOUVEAU déclencheur sont posés', () => {
    expect(conditionsApresChangement('lead.created', 'quote.viewed', {})).toEqual({ ouverture: 'premiere' });
    expect(conditionsApresChangement('quote.sent', 'invoice.viewed', null)).toEqual({ ouverture: 'premiere' });
  });

  it('un réglage que les DEUX déclencheurs déclarent est gardé (filtres d’étiquettes du client)', () => {
    const sortie = conditionsApresChangement('lead.created', 'invoice.sent', { client_a_etiquette: 'VIP', client_sans_etiquette: 'Ne pas relancer' });
    expect(sortie).toEqual({ client_a_etiquette: 'VIP', client_sans_etiquette: 'Ne pas relancer' });
  });

  it('un réglage du même nom garde la valeur choisie plutôt que le défaut du nouveau', () => {
    expect(conditionsApresChangement('quote.viewed', 'invoice.viewed', { ouverture: 'chaque' })).toEqual({ ouverture: 'chaque' });
  });

  it('une condition posée par un préréglage (hors réglages du déclencheur) ne suit pas non plus', () => {
    // `payment_type` n'a de sens que sur « Facture payée » : sur un autre événement, la règle ne partirait jamais.
    expect(conditionsApresChangement('invoice.paid', 'quote.sent', { payment_type: 'deposit' })).toEqual({});
  });

  it('les filtres sur les champs de la fiche suivent seulement si la fiche est de même nature', () => {
    const filtres = [{ field_id: 'f1', operateur: 'eq', valeur: 'x' }];
    // Deux déclencheurs de devis : mêmes champs de fiche.
    expect(conditionsApresChangement('quote.sent', 'quote.approved', { champs_perso: filtres })).toEqual({ champs_perso: filtres });
    // Un devis puis une facture : les champs ne désignent plus la même fiche.
    expect(conditionsApresChangement('quote.sent', 'invoice.sent', { champs_perso: filtres })).toEqual({});
  });

  it('pour TOUTE paire de déclencheurs, rien ne reste qui ne soit un réglage du nouveau', () => {
    const tout = Object.fromEntries(DECLENCHEURS.flatMap((d) => (d.champs ?? []).map((c) => [c.cle, 'x'])));
    for (const de of DECLENCHEURS) {
      for (const vers of DECLENCHEURS) {
        if (de.cle === vers.cle) continue;
        const permis = new Set([...(vers.champs ?? []).map((c) => c.cle), ...Object.keys(vers.conditions_defaut ?? {})]);
        const restes = Object.keys(conditionsApresChangement(de.cle, vers.cle, tout)).filter((k) => !permis.has(k));
        expect(restes, `${de.cle} → ${vers.cle}`).toEqual([]);
      }
    }
  });
});

describe('branchement', () => {
  const page = readFileSync(resolve(racine, 'src/pages/AutomationBuilderPage.tsx'), 'utf8');
  const route = readFileSync(resolve(racine, 'server/routes/automation-rules.ts'), 'utf8');

  it('le tiroir de l’éditeur envoie les conditions nettoyées avec le nouveau déclencheur', () => {
    expect(page).toMatch(/trigger_event: cle,\s+conditions: conditionsApresChangement\(regle\.trigger_event, cle,/);
    // L'ancienne fusion (« sans écraser ce que la règle portait déjà ») a disparu.
    expect(page).not.toMatch(/conditions: \{ \.\.\.defaut, \.\.\.\(\(regle\.conditions/);
  });

  it('un déclencheur changé par Lumi suit la même règle', () => {
    expect(page).toMatch(/conditionsApresChangement\(declencheurEnBase, propose\.trigger_event,/);
  });

  it('le serveur nettoie lui-même quand un client change le déclencheur sans parler des conditions', () => {
    expect(route).toMatch(/patch\.trigger_event !== existante\.trigger_event && !\('conditions' in patch\)\) \{\s+patch\.conditions = conditionsApresChangement\(/);
  });
});
