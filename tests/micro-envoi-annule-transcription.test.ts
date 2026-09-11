/**
 * Micro : envoyer pendant que la transcription finale est en vol.
 *
 * Bug vu le 2026-09-10 : l'utilisateur dicte, l'aperçu en direct s'affiche,
 * il appuie sur Envoyer avant la fin de la transcription ; le texte final
 * arrive ensuite et revient remplir la boîte, comme si l'envoi n'avait pas eu
 * lieu. Règle : un envoi ANNULE ce qui est en vol (voice.cancel()), et le
 * hook jette un résultat arrivé après annulation.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const lire = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

describe('envoyer pendant une transcription', () => {
  it('les deux chats annulent le micro avant de vider la boîte', () => {
    for (const fichier of ['src/pages/Lumi.tsx', 'src/features/agent/components/MrLumeChat.tsx']) {
      const src = lire(fichier);
      const iCancel = src.indexOf("if (voice.state !== 'idle') voice.cancel();");
      const iVide = src.indexOf("setInput('');", iCancel);
      expect(iCancel, `${fichier} : voice.cancel() manquant à l'envoi`).toBeGreaterThan(-1);
      expect(iVide, `${fichier} : setInput('') doit suivre l'annulation`).toBeGreaterThan(iCancel);
    }
  });

  it('le hook jette le texte final reçu après une annulation', () => {
    const src = lire('src/features/agent/hooks/useVoiceInput.ts');
    const iTranscribe = src.indexOf('await transcribeAudio(blob, language);');
    const iGarde = src.indexOf('if (cancelledRef.current) return;', iTranscribe);
    const iOn = src.indexOf('onTranscript(text.trim())', iTranscribe);
    expect(iTranscribe).toBeGreaterThan(-1);
    expect(iGarde, 'la garde cancelledRef doit précéder onTranscript').toBeGreaterThan(iTranscribe);
    expect(iOn).toBeGreaterThan(iGarde);
  });
});
