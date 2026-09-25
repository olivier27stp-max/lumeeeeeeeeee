/**
 * Détourage du fond blanc d'un logo (2026-09-17).
 *
 * Ce qui compte n'est pas seulement qu'il détoure, mais qu'il REFUSE de le
 * faire quand le résultat serait mauvais : un logo troué ou une photo massacrée
 * partent ensuite dans tous les courriels de l'entreprise.
 */
import { describe, it, expect } from 'vitest';
import zlib from 'node:zlib';
import { detourerLogo, estPng, estJpeg } from '../../server/lib/images/detourer-logo';

/** Fabrique un PNG RGBA 8 bits non entrelacé (filtre 0), sans dépendance. */
function fabriquerPng(largeur: number, hauteur: number, peindre: (x: number, y: number) => [number, number, number, number]): Buffer {
  const parLigne = largeur * 4;
  const brut = Buffer.alloc((parLigne + 1) * hauteur);
  for (let y = 0; y < hauteur; y++) {
    brut[y * (parLigne + 1)] = 0;
    for (let x = 0; x < largeur; x++) {
      const [r, g, b, a] = peindre(x, y);
      const i = y * (parLigne + 1) + 1 + x * 4;
      brut[i] = r; brut[i + 1] = g; brut[i + 2] = b; brut[i + 3] = a;
    }
  }
  const crc = (buf: Buffer) => {
    let c = ~0;
    for (let i = 0; i < buf.length; i++) { c ^= buf[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
    return ~c >>> 0;
  };
  const morceau = (type: string, d: Buffer) => {
    const t = Buffer.alloc(4); t.writeUInt32BE(d.length, 0);
    const corps = Buffer.concat([Buffer.from(type, 'ascii'), d]);
    const s = Buffer.alloc(4); s.writeUInt32BE(crc(corps), 0);
    return Buffer.concat([t, corps, s]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largeur, 0); ihdr.writeUInt32BE(hauteur, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    morceau('IHDR', ihdr),
    morceau('IDAT', zlib.deflateSync(brut)),
    morceau('IEND', Buffer.alloc(0)),
  ]);
}

const BLANC: [number, number, number, number] = [255, 255, 255, 255];
const NOIR: [number, number, number, number] = [10, 10, 10, 255];

describe('détourage du logo', () => {
  it('retire le fond blanc autour du dessin et recadre', () => {
    // Un carré noir de 20 px centré dans 60×60 de blanc.
    const png = fabriquerPng(60, 60, (x, y) => (x >= 20 && x < 40 && y >= 20 && y < 40 ? NOIR : BLANC));
    const r = detourerLogo(png, 'image/png');
    expect(r.detoure).toBe(true);
    expect(r.contentType).toBe('image/png');
    // Recadré sur le dessin : la largeur du PNG de sortie est celle du carré.
    expect(r.buffer.readUInt32BE(16)).toBe(20);
    expect(r.buffer.readUInt32BE(20)).toBe(20);
  });

  it('PRÉSERVE le blanc enfermé dans le dessin (le trou d’un anneau)', () => {
    // Anneau noir : blanc au centre, blanc autour. Un seuil global troue le
    // centre ; la diffusion depuis les bords ne doit pas y toucher.
    const png = fabriquerPng(60, 60, (x, y) => {
      const d = Math.hypot(x - 30, y - 30);
      return d > 10 && d < 24 ? NOIR : BLANC;
    });
    const r = detourerLogo(png, 'image/png');
    expect(r.detoure).toBe(true);
    // Le PNG de sortie contient encore du blanc opaque : le centre de l'anneau.
    const sortie = zlib.inflateSync(
      (() => { // extraire l'IDAT
        let i = 8; const parts: Buffer[] = [];
        while (i + 8 <= r.buffer.length) {
          const n = r.buffer.readUInt32BE(i);
          if (r.buffer.toString('ascii', i + 4, i + 8) === 'IDAT') parts.push(r.buffer.subarray(i + 8, i + 8 + n));
          i += 12 + n;
        }
        return Buffer.concat(parts);
      })(),
    );
    let blancOpaque = 0;
    for (let p = 0; p + 3 < sortie.length; p += 4) {
      if (sortie[p] > 250 && sortie[p + 1] > 250 && sortie[p + 2] > 250 && sortie[p + 3] === 255) blancOpaque++;
    }
    expect(blancOpaque).toBeGreaterThan(50);
  });

  it('REFUSE une image dont le bord n’est pas blanc (photo, fond coloré)', () => {
    const png = fabriquerPng(40, 40, () => [30, 120, 200, 255]);
    const r = detourerLogo(png, 'image/png');
    expect(r.detoure).toBe(false);
    expect(r.raison).toContain('bord');
    expect(r.buffer).toBe(png);
  });

  it('REFUSE quand il n’y a presque pas de fond à retirer', () => {
    // Un liseré d'un pixel sur 100 de côté = 4 % du cadre, sous le seuil de 6 % :
    // le logo n'avait pas de marge blanche, le réécrire n'apporterait rien.
    const png = fabriquerPng(100, 100, (x, y) => (x === 0 || y === 0 || x === 99 || y === 99 ? BLANC : NOIR));
    const r = detourerLogo(png, 'image/png');
    expect(r.detoure).toBe(false);
    expect(r.raison).toContain('pas de fond blanc');
    expect(r.buffer).toBe(png);
  });

  it('REFUSE une image entièrement blanche (on aurait tout mangé)', () => {
    const png = fabriquerPng(40, 40, () => BLANC);
    const r = detourerLogo(png, 'image/png');
    expect(r.detoure).toBe(false);
    expect(r.buffer).toBe(png);
  });

  it('laisse un JPEG intact : il ne peut pas porter de transparence', () => {
    const faux = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200)]);
    const r = detourerLogo(faux, 'image/jpeg');
    expect(r.detoure).toBe(false);
    expect(r.contentType).toBe('image/jpeg');
    expect(r.buffer).toBe(faux);
  });

  it('ne casse jamais sur une entrée qui n’est pas une image', () => {
    const r = detourerLogo(Buffer.from('bonjour'), 'image/png');
    expect(r.detoure).toBe(false);
    expect(r.buffer.toString()).toBe('bonjour');
  });

  it('reconnaît les formats', () => {
    expect(estPng(fabriquerPng(2, 2, () => BLANC))).toBe(true);
    expect(estJpeg(Buffer.from([0xff, 0xd8, 0xff, 0]))).toBe(true);
    expect(estPng(Buffer.from('x'))).toBe(false);
  });
});
