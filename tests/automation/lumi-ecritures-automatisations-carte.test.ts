/**
 * Aucun outil de Lumi qui change ce qu'une automatisation ENVOIE ne s'exécute sans carte.
 *
 * « Sensible » ne protège que le mode « argent » : en mode « tout », seul `JAMAIS_D_OFFICE`
 * retient un outil. Constat de la carte (mission finale, 2026-10-02) : `update_automation_from_text`
 * — qui réécrit le parcours d'une automatisation, publiée ou non — et `set_automation_language`
 * étaient « sensibles » mais absents de la liste : en mode « tout », Lumi modifiait une
 * automatisation publiée sans rien demander.
 *
 * Le test CLASSE chaque outil d'écriture qui touche les automatisations. Un outil nouveau qui
 * n'est dans aucune des deux listes fait échouer la suite : il faut décider, pas oublier.
 */
import { describe, it, expect } from 'vitest';
import { JAMAIS_D_OFFICE, REGISTRE_ECRITURES } from '../../server/lib/agent/registre';
import { outilsAutorisesParMode } from '../../server/lib/lumi/execution';

/** Change ce que des clients recevront, fait partir ou repartir des envois, ou les annule. */
const TOUJOURS_UNE_CARTE = [
  'create_automation_from_text', 'create_automation_from_template',
  'update_automation_from_text', 'update_automation_message', 'update_automation_sms_body',
  'toggle_automation_rule', 'pause_all_automations', 'delete_automation_rule',
  'set_automation_language',
];
/** Sans effet sur un envoi : un nom, une copie créée ÉTEINTE. */
const SANS_EFFET_SUR_UN_ENVOI = ['rename_automation_rule', 'duplicate_automation_rule'];

const outilsDAutomatisation = Object.keys(REGISTRE_ECRITURES).filter((n) => /automation/.test(n));

describe('écritures de Lumi sur les automatisations', () => {
  it('chaque outil est classé : carte obligatoire, ou sans effet sur un envoi', () => {
    const classes = new Set([...TOUJOURS_UNE_CARTE, ...SANS_EFFET_SUR_UN_ENVOI]);
    expect(outilsDAutomatisation.filter((n) => !classes.has(n))).toEqual([]);
    // Et les listes ne citent pas un outil qui n'existe plus.
    expect([...classes].filter((n) => !(n in REGISTRE_ECRITURES))).toEqual([]);
  });

  it.each(TOUJOURS_UNE_CARTE)('%s : jamais d’office', (outil) => {
    expect(JAMAIS_D_OFFICE.has(outil)).toBe(true);
  });

  it('même en mode « tout », aucun de ces outils n’est autorisé sans clic', () => {
    const autorises = outilsAutorisesParMode('tout', Object.keys(REGISTRE_ECRITURES), new Set());
    expect(TOUJOURS_UNE_CARTE.filter((n) => autorises.has(n))).toEqual([]);
  });
});
