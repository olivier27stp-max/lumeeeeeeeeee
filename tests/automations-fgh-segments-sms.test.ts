/**
 * H — Textos avec accents : encodage (GSM-7 / UCS-2) et nombre de segments
 * facturés, et ce que l'entrepreneur en VOIT dans l'éditeur.
 *
 * GSM-7 contient é è ù ì ò à É Ç (160 caractères, puis 153 par segment) ;
 * ê â î ô û ç ë ï, l'apostrophe typographique ’ et « » n'y sont pas : UN
 * seul de ces caractères fait passer tout le texto en UCS-2 (70, puis 67
 * par segment) — le coût peut doubler ou tripler sans qu'on le voie.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { segmentsSms, avecMentionCommerciale } from '../server/lib/desabonnement/mention-sms';
import { messageConfirmation } from '../server/lib/desabonnement';

describe('H — segments et encodage des textos', () => {
  it('[H-010] accents du GSM-7 (é è à ù) : 160 caractères par texto, 153 ensuite', () => {
    const base = 'Bonjour, votre rendez-vous est confirmé à Québec. À très bientôt, déjà prêt ? ';
    expect(segmentsSms('é'.repeat(160))).toEqual({ encodage: 'GSM-7', unites: 160, segments: 1 });
    expect(segmentsSms('è'.repeat(161))).toEqual({ encodage: 'GSM-7', unites: 161, segments: 2 });
    expect(segmentsSms('a'.repeat(306)).segments).toBe(2);
    expect(segmentsSms('a'.repeat(307)).segments).toBe(3);
    // « prêt » : un ê suffit à tout passer en UCS-2.
    expect(segmentsSms(base).encodage).toBe('UCS-2');
  });

  it('[H-011] un seul ê, ç, ’ ou « » : UCS-2, 70 caractères par texto, 67 ensuite', () => {
    for (const c of ['ê', 'ç', '’', '«', '»', 'ô', 'î', 'û', 'ë']) {
      const t = `${'a'.repeat(69)}${c}`;
      expect(segmentsSms(t), c).toEqual({ encodage: 'UCS-2', unites: 70, segments: 1 });
      expect(segmentsSms(`${t}a`).segments, c).toBe(2);
    }
    expect(segmentsSms('a'.repeat(133) + 'ç').segments).toBe(2);
    expect(segmentsSms('a'.repeat(134) + 'ç').segments).toBe(3);
    // Caractères d'extension GSM : deux unités chacun.
    expect(segmentsSms('€[]').unites).toBe(6);
  });

  it('[H-012] la mention STOP ajoutée reste en GSM-7 et ne fait pas basculer un texto GSM-7', () => {
    const fr = avecMentionCommerciale('Offre du printemps : 20 % de rabais', 'Nettoyage Test A', 'fr');
    const en = avecMentionCommerciale('Spring offer: 20% off', 'Nettoyage Test A', 'en');
    expect(segmentsSms(fr).encodage).toBe('GSM-7');
    expect(segmentsSms(en).encodage).toBe('GSM-7');
  });

  it('[H-013] mesure : confirmations STOP / REPRENDRE — l’arrêt reste en GSM-7, la reprise française passe en UCS-2 (« êtes »)', () => {
    const stop = segmentsSms(messageConfirmation('stop', 'Nettoyage Test A', 'fr'));
    expect(stop.encodage).toBe('GSM-7');
    expect(stop.segments).toBe(2); // 186 caractères : deux textos facturés
    const reprise = messageConfirmation('start', 'Nettoyage Test A', 'fr');
    expect(segmentsSms(reprise)).toEqual({ encodage: 'UCS-2', unites: reprise.length, segments: 2 });
    expect(segmentsSms(messageConfirmation('start', 'Nettoyage Test A', 'en')).encodage).toBe('GSM-7');
  });

  it('[H-014] l’éditeur de texto affiche le VRAI nombre de segments (accents compris), pas longueur / 160', () => {
    const source = readFileSync(join(process.cwd(), 'src/components/automations/MessageEditor.tsx'), 'utf8');
    // `libelleSegments` (src/lib/smsSegments.ts, #840) s'appuie sur `segmentsSms` : l'un ou l'autre.
    expect(source, 'le compteur doit utiliser le calcul d’encodage').toMatch(/(segmentsSms|libelleSegments)\(/);
    expect(source, 'longueur / 160 ignore l’UCS-2 (accents ê, ç, ’) et le 153 des textos longs').not.toMatch(/\.length \/ 160/);
  });
});
