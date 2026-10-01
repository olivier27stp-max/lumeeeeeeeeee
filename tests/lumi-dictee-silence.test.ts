/**
 * Un enregistrement sans voix ne part pas au modèle de transcription.
 *
 * Batterie de robustesse du 2026-10-01 (vocal.silence) : une seconde de
 * silence envoyée à POST /api/agent/transcribe revenait avec « Ok, affiche-moi
 * la liste des clients qui ont une facture en retard. » — une phrase inventée,
 * que l'app aurait déposée dans la boîte de Lumi comme une demande.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../server/lib/config', () => ({ geminiApiKey: 'cle-de-test' }));

import { wavSansVoix, transcribeAudioAvecUsage } from '../server/lib/agent/transcribe';

const TAUX = 16_000;

/** WAV PCM 16 bits mono, comme celui du micro de l'app (useVoiceInput.ts). */
function wav(echantillons: Float32Array, taux = TAUX): Buffer {
  const b = Buffer.alloc(44 + echantillons.length * 2);
  b.write('RIFF', 0, 'latin1'); b.writeUInt32LE(36 + echantillons.length * 2, 4); b.write('WAVE', 8, 'latin1');
  b.write('fmt ', 12, 'latin1'); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(taux, 24); b.writeUInt32LE(taux * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36, 'latin1'); b.writeUInt32LE(echantillons.length * 2, 40);
  for (let i = 0; i < echantillons.length; i++) {
    const x = Math.max(-1, Math.min(1, echantillons[i]));
    b.writeInt16LE(Math.round(x < 0 ? x * 0x8000 : x * 0x7fff), 44 + i * 2);
  }
  return b;
}

const silence = (secondes: number) => new Float32Array(Math.round(TAUX * secondes));
/** Un ton de 220 Hz à l'amplitude donnée : tient lieu de voix pour le niveau sonore. */
function ton(secondes: number, amplitude: number): Float32Array {
  const s = new Float32Array(Math.round(TAUX * secondes));
  for (let i = 0; i < s.length; i++) s[i] = amplitude * Math.sin((2 * Math.PI * 220 * i) / TAUX);
  return s;
}
const bout = (...morceaux: Float32Array[]) => {
  const s = new Float32Array(morceaux.reduce((n, m) => n + m.length, 0));
  let o = 0;
  for (const m of morceaux) { s.set(m, o); o += m.length; }
  return s;
};

describe('wavSansVoix — le niveau sonore d’un enregistrement', () => {
  it('une seconde de silence : rien à transcrire', () => {
    expect(wavSansVoix(wav(silence(1)))).toBe(true);
  });

  it('un souffle de fond (bien sous le seuil du micro) : rien à transcrire', () => {
    expect(wavSansVoix(wav(ton(2, 0.003)))).toBe(true);
  });

  it('une voix à niveau normal : à transcrire', () => {
    expect(wavSansVoix(wav(ton(1, 0.1)))).toBe(false);
  });

  it('un seul mot au milieu de dix secondes de silence : à transcrire', () => {
    expect(wavSansVoix(wav(bout(silence(5), ton(0.3, 0.08), silence(5))))).toBe(false);
  });

  it('une voix faible, juste au seuil du micro de l’app (RMS 0,012) : jamais écartée', () => {
    // RMS d'un sinus = amplitude / √2 ; 0,017 d'amplitude ≈ 0,012 de RMS.
    expect(wavSansVoix(wav(ton(1, 0.017)))).toBe(false);
  });

  it('ce qui n’est pas un WAV PCM 16 bits lisible passe au modèle comme avant', () => {
    expect(wavSansVoix(Buffer.from('pas un fichier audio du tout, mais assez long pour un en-tête'))).toBe(false);
    const huitBits = wav(silence(1)); huitBits.writeUInt16LE(8, 34);
    expect(wavSansVoix(huitBits)).toBe(false);
    const flottant = wav(silence(1)); flottant.writeUInt16LE(3, 20);
    expect(wavSansVoix(flottant)).toBe(false);
    expect(wavSansVoix(wav(silence(1)).subarray(0, 40))).toBe(false);
  });
});

describe('transcribeAudioAvecUsage — le silence ne coûte rien et ne dit rien', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('un WAV silencieux : texte vide, AUCUN appel au modèle', async () => {
    const appel = vi.fn();
    vi.stubGlobal('fetch', appel);
    const r = await transcribeAudioAvecUsage({ base64: wav(silence(1)).toString('base64'), mimeType: 'audio/wav', language: 'fr' });
    expect(r.text).toBe('');
    expect(r.usage).toBeNull();
    expect(appel).not.toHaveBeenCalled();
  });

  it('un WAV parlé part au modèle', async () => {
    const appel = vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Mes jobs de demain.' }] } }] }), { status: 200 }));
    vi.stubGlobal('fetch', appel);
    const r = await transcribeAudioAvecUsage({ base64: wav(ton(1, 0.1)).toString('base64'), mimeType: 'audio/wav', language: 'fr' });
    expect(r.text).toBe('Mes jobs de demain.');
    expect(appel).toHaveBeenCalledTimes(1);
  });

  it('un autre format (note vocale par texto) part au modèle, même silencieux : on ne sait pas le lire ici', async () => {
    const appel = vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '' }] } }] }), { status: 200 }));
    vi.stubGlobal('fetch', appel);
    await transcribeAudioAvecUsage({ base64: wav(silence(1)).toString('base64'), mimeType: 'audio/ogg', language: 'fr' });
    expect(appel).toHaveBeenCalledTimes(1);
  });
});
