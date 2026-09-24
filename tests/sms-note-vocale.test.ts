/**
 * Notes vocales reçues par texto.
 *
 * Le corps d'un message Twilio arrive du réseau : tout y est falsifiable. Ces
 * tests figent ce qu'on accepte de lire, ce qu'on refuse, et le fait qu'un
 * vocal illisible reçoive une réponse plutôt qu'un silence.
 */
import { describe, it, expect } from 'vitest';
import {
  mediasAudio,
  estNoteVocale,
  typeTranscriptible,
  messageEchecVocal,
} from '../server/lib/sms/note-vocale';

describe('mediasAudio', () => {
  it('relève un vocal Twilio ordinaire', () => {
    const m = mediasAudio({
      NumMedia: '1',
      MediaUrl0: 'https://api.twilio.com/2010-04-01/Accounts/AC1/Messages/MM1/Media/ME1',
      MediaContentType0: 'audio/ogg',
    });
    expect(m).toHaveLength(1);
    expect(m[0].contentType).toBe('audio/ogg');
  });

  it('accepte plusieurs médias, dans l’ordre', () => {
    const m = mediasAudio({
      NumMedia: '2',
      MediaUrl0: 'https://api.twilio.com/a', MediaContentType0: 'audio/ogg',
      MediaUrl1: 'https://api.twilio.com/b', MediaContentType1: 'audio/mp4',
    });
    expect(m.map((x) => x.contentType)).toEqual(['audio/ogg', 'audio/mp4']);
  });

  it('ignore une image ou un PDF : seul l’audio nous intéresse', () => {
    const m = mediasAudio({
      NumMedia: '2',
      MediaUrl0: 'https://api.twilio.com/a', MediaContentType0: 'image/jpeg',
      MediaUrl1: 'https://api.twilio.com/b', MediaContentType1: 'application/pdf',
    });
    expect(m).toHaveLength(0);
  });

  it('refuse une URL qui n’est pas en HTTPS', () => {
    // Le corps du webhook est falsifiable : une URL http:// ou file:// ne doit
    // jamais être téléchargée, même signée.
    for (const url of ['http://evil.test/a.ogg', 'file:///etc/passwd', 'ftp://x/a.ogg']) {
      expect(mediasAudio({ NumMedia: '1', MediaUrl0: url, MediaContentType0: 'audio/ogg' })).toHaveLength(0);
    }
  });

  it('tolère NumMedia absent, vide ou non numérique', () => {
    for (const n of [undefined, '', 'abc', '-1', '0']) {
      expect(mediasAudio({ NumMedia: n, MediaUrl0: 'https://x/a', MediaContentType0: 'audio/ogg' })).toHaveLength(0);
    }
  });

  it('borne le nombre de médias lus', () => {
    const corps: Record<string, string> = { NumMedia: '500' };
    for (let i = 0; i < 500; i += 1) {
      corps[`MediaUrl${i}`] = 'https://api.twilio.com/x';
      corps[`MediaContentType${i}`] = 'audio/ogg';
    }
    expect(mediasAudio(corps).length).toBeLessThanOrEqual(10);
  });

  it('lit le type même avec un paramètre de codec collé', () => {
    const m = mediasAudio({ NumMedia: '1', MediaUrl0: 'https://x/a', MediaContentType0: 'audio/ogg; codecs=opus' });
    expect(m[0].contentType).toBe('audio/ogg');
  });
});

describe('estNoteVocale', () => {
  it('un texte ordinaire n’en est pas une', () => {
    expect(estNoteVocale({ Body: 'salut', NumMedia: '0' })).toBe(false);
  });

  it('un message sans corps mais avec audio en est une', () => {
    // C'est exactement la forme que le webhook rejetait : Body vide.
    expect(estNoteVocale({ Body: '', NumMedia: '1', MediaUrl0: 'https://x/a', MediaContentType0: 'audio/ogg' })).toBe(true);
  });

  it('ne casse pas sur un corps absent', () => {
    expect(estNoteVocale(null)).toBe(false);
    expect(estNoteVocale(undefined)).toBe(false);
  });
});

describe('typeTranscriptible', () => {
  it('accepte les formats que les téléphones produisent', () => {
    for (const t of ['audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/webm']) {
      expect(typeTranscriptible(t), t).not.toBeNull();
    }
  });

  it('ramène les alias au format réel', () => {
    expect(typeTranscriptible('audio/x-m4a')).toBe('audio/mp4');
    expect(typeTranscriptible('audio/m4a')).toBe('audio/mp4');
    expect(typeTranscriptible('audio/mp3')).toBe('audio/mpeg');
    expect(typeTranscriptible('audio/x-wav')).toBe('audio/wav');
  });

  it('refuse l’AMR : il faudrait le convertir, on préfère le dire', () => {
    // Un MMS d'opérateur peut arriver en AMR. Le transcripteur ne le lit pas ;
    // mieux vaut un message clair qu'une transcription vide.
    expect(typeTranscriptible('audio/amr')).toBeNull();
    expect(typeTranscriptible('audio/3gpp')).toBeNull();
  });

  it('ignore la casse et les paramètres', () => {
    expect(typeTranscriptible('AUDIO/OGG; codecs=opus')).toBe('audio/ogg');
  });
});

describe('messageEchecVocal', () => {
  it('répond toujours quelque chose, dans les deux langues', () => {
    for (const r of ['format_non_supporte', 'trop_gros', 'telechargement', 'transcription', 'vide'] as const) {
      for (const langue of ['fr', 'en'] as const) {
        const m = messageEchecVocal(r, langue);
        expect(m.length, `${r}/${langue}`).toBeGreaterThan(20);
      }
    }
  });

  it('n’expose jamais de terme technique à l’expéditeur', () => {
    // Même règle que les consignes de Lumi : pas de jargon, pas de nom de
    // format, pas de message d'erreur brut.
    for (const r of ['format_non_supporte', 'trop_gros', 'telechargement', 'transcription', 'vide'] as const) {
      const m = messageEchecVocal(r, 'fr').toLowerCase();
      for (const mot of ['audio/', 'mime', 'twilio', 'gemini', 'http', 'transcription', 'erreur 4', 'null']) {
        expect(m, `${r} ne doit pas contenir « ${mot} »`).not.toContain(mot);
      }
    }
  });
});
