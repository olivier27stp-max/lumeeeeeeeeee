/**
 * Détourage du fond blanc d'un logo, au téléversement (2026-09-17).
 * ─────────────────────────────────────────────────────────────────
 * Rafba : « fais juste en sorte que quand quelqu'un upload un logo le
 * background soit enlevé ».
 *
 * Le problème est réel et général : la plupart des entreprises n'ont qu'un
 * JPEG de leur logo, où le blanc est CUIT dans l'image. Posé sur le ciel des
 * courriels ou sur une page publique, ce logo traîne un rectangle blanc
 * derrière lui. Aucun CSS ne peut l'enlever — il faut réécrire les pixels.
 *
 * Pourquoi pas `sharp` : c'est un binaire natif (~30 Mo, recompilé par
 * plateforme) pour une opération qu'on fait quelques fois par organisation.
 * Ici : zéro dépendance, `zlib` de Node suffit.
 *
 * Comment : on remplit depuis les BORDS (diffusion 4-connexe). Seul le blanc
 * qui touche le bord devient transparent ; le blanc ENFERMÉ dans le dessin
 * (le contre-poinçon d'un « O », l'intérieur d'un anneau) est préservé. Un
 * simple seuil global, lui, troue le logo.
 *
 * Trois refus volontaires, parce qu'un mauvais détourage est pire que pas de
 * détourage :
 *   - bord non uniforme (photo, fond dégradé) → on renvoie l'original ;
 *   - moins de 6 % de fond enlevé → le logo n'avait pas de marge blanche ;
 *   - plus de 96 % enlevé → on aurait mangé le dessin.
 */
import zlib from 'node:zlib';
import jpeg from 'jpeg-js';

/** Au-dessus de ce niveau sur les trois canaux, un pixel compte comme « blanc ». */
const SEUIL_BLANC = 238;
/** Tolérance du bord : au-delà, le fond n'est pas uni et on ne touche à rien. */
const SEUIL_BORD = 245;
const MIN_EFFACE = 0.06;
const MAX_EFFACE = 0.96;
/** Un logo raisonnable ; au-delà on ne tente rien (coût mémoire). */
const MAX_PIXELS = 4_000_000;

export interface Detourage {
  /** Le PNG détouré, ou l'original si on n'a rien pu faire de sûr. */
  buffer: Buffer;
  contentType: string;
  /** Vrai seulement si le fond a bel et bien été retiré. */
  detoure: boolean;
  /** Pourquoi on s'est abstenu — journalisé, jamais montré à l'utilisateur. */
  raison?: string;
}

interface Image { largeur: number; hauteur: number; pixels: Uint8Array } // RGBA

// ── PNG : lecture ───────────────────────────────────────────────────────────

const SIGNATURE_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function estPng(buf: Buffer): boolean {
  return buf.length > 8 && buf.subarray(0, 8).equals(SIGNATURE_PNG);
}

export function estJpeg(buf: Buffer): boolean {
  return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

function pasteur(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * Décode un PNG 8 bits, couleur vraie (type 2) ou couleur+alpha (type 6), non
 * entrelacé. Les autres formes (palette, 16 bits, entrelacé Adam7) renvoient
 * null : on préfère ne rien faire plutôt que de rendre une image fausse.
 */
function lirePng(buf: Buffer): Image | null {
  if (!estPng(buf)) return null;
  const largeur = buf.readUInt32BE(16);
  const hauteur = buf.readUInt32BE(20);
  const profondeur = buf[24];
  const typeCouleur = buf[25];
  const entrelacement = buf[28];
  if (profondeur !== 8 || (typeCouleur !== 2 && typeCouleur !== 6) || entrelacement !== 0) return null;
  if (!largeur || !hauteur || largeur * hauteur > MAX_PIXELS) return null;

  // Concaténer les IDAT (un PNG peut en contenir plusieurs).
  const morceaux: Buffer[] = [];
  let i = 8;
  while (i + 8 <= buf.length) {
    const taille = buf.readUInt32BE(i);
    const type = buf.toString('ascii', i + 4, i + 8);
    if (type === 'IDAT') morceaux.push(buf.subarray(i + 8, i + 8 + taille));
    if (type === 'IEND') break;
    i += 12 + taille;
    if (taille < 0 || i > buf.length) return null;
  }
  if (!morceaux.length) return null;

  let brut: Buffer;
  try {
    brut = zlib.inflateSync(Buffer.concat(morceaux));
  } catch {
    return null;
  }

  const canaux = typeCouleur === 6 ? 4 : 3;
  const parLigne = largeur * canaux;
  if (brut.length < (parLigne + 1) * hauteur) return null;

  // Défiltrage PNG (types 0 à 4), ligne par ligne.
  const sansFiltre = Buffer.alloc(parLigne * hauteur);
  for (let y = 0; y < hauteur; y++) {
    const filtre = brut[y * (parLigne + 1)];
    const src = y * (parLigne + 1) + 1;
    const dst = y * parLigne;
    const precedente = dst - parLigne;
    for (let x = 0; x < parLigne; x++) {
      const val = brut[src + x];
      const a = x >= canaux ? sansFiltre[dst + x - canaux] : 0;
      const b = y > 0 ? sansFiltre[precedente + x] : 0;
      const c = x >= canaux && y > 0 ? sansFiltre[precedente + x - canaux] : 0;
      let out: number;
      switch (filtre) {
        case 0: out = val; break;
        case 1: out = val + a; break;
        case 2: out = val + b; break;
        case 3: out = val + ((a + b) >> 1); break;
        case 4: out = val + pasteur(a, b, c); break;
        default: return null;
      }
      sansFiltre[dst + x] = out & 0xff;
    }
  }

  const pixels = new Uint8Array(largeur * hauteur * 4);
  for (let p = 0, q = 0; p < largeur * hauteur; p++) {
    const s = p * canaux;
    pixels[q++] = sansFiltre[s];
    pixels[q++] = sansFiltre[s + 1];
    pixels[q++] = sansFiltre[s + 2];
    pixels[q++] = canaux === 4 ? sansFiltre[s + 3] : 255;
  }
  return { largeur, hauteur, pixels };
}

// ── PNG : écriture ──────────────────────────────────────────────────────────

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function morceau(type: string, donnees: Buffer): Buffer {
  const taille = Buffer.alloc(4);
  taille.writeUInt32BE(donnees.length, 0);
  const corps = Buffer.concat([Buffer.from(type, 'ascii'), donnees]);
  const somme = Buffer.alloc(4);
  somme.writeUInt32BE(crc32(corps), 0);
  return Buffer.concat([taille, corps, somme]);
}

function ecrirePng(img: Image): Buffer {
  const { largeur, hauteur, pixels } = img;
  const parLigne = largeur * 4;
  // Filtre 0 (aucun) : zlib fait le gros du travail, et on évite un aller-retour.
  const brut = Buffer.alloc((parLigne + 1) * hauteur);
  for (let y = 0; y < hauteur; y++) {
    brut[y * (parLigne + 1)] = 0;
    Buffer.from(pixels.buffer, pixels.byteOffset + y * parLigne, parLigne)
      .copy(brut, y * (parLigne + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largeur, 0);
  ihdr.writeUInt32BE(hauteur, 4);
  ihdr[8] = 8;   // 8 bits par canal
  ihdr[9] = 6;   // RGBA
  return Buffer.concat([
    SIGNATURE_PNG,
    morceau('IHDR', ihdr),
    morceau('IDAT', zlib.deflateSync(brut, { level: 9 })),
    morceau('IEND', Buffer.alloc(0)),
  ]);
}

// ── Le détourage ────────────────────────────────────────────────────────────

/**
 * Retire le fond blanc d'un logo PNG. Renvoie toujours un buffer utilisable :
 * l'original si le détourage n'est pas sûr.
 */
export function detourerLogo(entree: Buffer, contentType: string): Detourage {
  const intact = (raison: string): Detourage => ({ buffer: entree, contentType, detoure: false, raison });

  // Le format compte : en prod, la moitié des logos téléversés sont des JPEG,
  // justement ceux qui traînent un fond blanc. Les ignorer viderait la
  // fonctionnalité de son sens. On les décode et on ressort du PNG, seul
  // format de la paire à porter un canal alpha.
  let img: Image | null = null;
  if (estJpeg(entree)) {
    try {
      const d = jpeg.decode(entree, { useTArray: true, maxMemoryUsageInMB: 64 });
      if (!d?.width || !d?.height || d.width * d.height > MAX_PIXELS) return intact('jpeg trop grand');
      img = { largeur: d.width, hauteur: d.height, pixels: new Uint8Array(d.data) };
    } catch {
      return intact('jpeg illisible');
    }
  } else {
    img = lirePng(entree);
    if (!img) return intact('png non pris en charge (palette, 16 bits ou entrelacé)');
  }

  const { largeur: L, hauteur: H, pixels } = img;
  const blanc = (i: number) =>
    pixels[i] >= SEUIL_BLANC && pixels[i + 1] >= SEUIL_BLANC && pixels[i + 2] >= SEUIL_BLANC && pixels[i + 3] > 0;

  // Le bord doit être uniformément clair, sinon ce n'est pas un logo sur fond
  // blanc (photo, capture d'écran, fond coloré) et on n'y touche pas.
  for (let x = 0; x < L; x++) {
    for (const y of [0, H - 1]) {
      const i = (y * L + x) * 4;
      if (pixels[i + 3] > 0 && (pixels[i] < SEUIL_BORD || pixels[i + 1] < SEUIL_BORD || pixels[i + 2] < SEUIL_BORD)) {
        return intact('bord non uniforme');
      }
    }
  }
  for (let y = 0; y < H; y++) {
    for (const x of [0, L - 1]) {
      const i = (y * L + x) * 4;
      if (pixels[i + 3] > 0 && (pixels[i] < SEUIL_BORD || pixels[i + 1] < SEUIL_BORD || pixels[i + 2] < SEUIL_BORD)) {
        return intact('bord non uniforme');
      }
    }
  }

  // Diffusion depuis les bords : file d'attente d'index, pas de récursion
  // (une pile d'appels ne tient pas sur un logo de 2000 px).
  const vu = new Uint8Array(L * H);
  const file = new Int32Array(L * H);
  let tete = 0, queue = 0;
  const pousser = (p: number) => {
    if (!vu[p] && blanc(p * 4)) { vu[p] = 1; file[queue++] = p; }
  };
  for (let x = 0; x < L; x++) { pousser(x); pousser((H - 1) * L + x); }
  for (let y = 0; y < H; y++) { pousser(y * L); pousser(y * L + L - 1); }

  while (tete < queue) {
    const p = file[tete++];
    const x = p % L, y = (p / L) | 0;
    if (x > 0) pousser(p - 1);
    if (x < L - 1) pousser(p + 1);
    if (y > 0) pousser(p - L);
    if (y < H - 1) pousser(p + L);
  }

  let efface = 0;
  for (let p = 0; p < L * H; p++) if (vu[p]) { pixels[p * 4 + 3] = 0; efface++; }

  const part = efface / (L * H);
  if (part < MIN_EFFACE) return intact('pas de fond blanc à retirer');
  if (part > MAX_EFFACE) return intact('le détourage aurait mangé le dessin');

  // Bord adouci : un pixel clair qui touche le vide devient partiellement
  // transparent. Sans cela, le contour est crénelé sur un fond coloré.
  const copieAlpha = new Uint8Array(L * H);
  for (let p = 0; p < L * H; p++) copieAlpha[p] = pixels[p * 4 + 3];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < L; x++) {
      const p = y * L + x;
      if (copieAlpha[p] === 0) continue;
      const vide =
        (x > 0 && copieAlpha[p - 1] === 0) || (x < L - 1 && copieAlpha[p + 1] === 0) ||
        (y > 0 && copieAlpha[p - L] === 0) || (y < H - 1 && copieAlpha[p + L] === 0);
      if (!vide) continue;
      const i = p * 4;
      const clarte = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
      if (clarte > 200) pixels[i + 3] = Math.round(pixels[i + 3] * (1 - Math.min(1, (clarte - 200) / 55)));
    }
  }

  // Recadrer sur le dessin : la marge blanche devenue transparente occuperait
  // sinon la place du logo dans les courriels.
  let minX = L, minY = H, maxX = -1, maxY = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < L; x++) {
      if (pixels[(y * L + x) * 4 + 3] === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX || maxY < minY) return intact('image vide après détourage');

  const nl = maxX - minX + 1, nh = maxY - minY + 1;
  const coupe = new Uint8Array(nl * nh * 4);
  for (let y = 0; y < nh; y++) {
    const src = ((y + minY) * L + minX) * 4;
    coupe.set(pixels.subarray(src, src + nl * 4), y * nl * 4);
  }

  const sortie = ecrirePng({ largeur: nl, hauteur: nh, pixels: coupe });
  // Un PNG sans perte est forcément plus lourd qu'un JPEG compressé : comparer
  // les tailles reviendrait à toujours refuser les JPEG, précisément ceux qu'on
  // veut traiter. On plafonne donc en absolu, pas par rapport à l'entrée.
  const PLAFOND = 2_000_000;
  if (sortie.length > PLAFOND) return intact('le fichier détouré serait trop lourd');
  if (!estJpeg(entree) && sortie.length > entree.length * 3) return intact('le png détouré serait trop lourd');

  return { buffer: sortie, contentType: 'image/png', detoure: true };
}
