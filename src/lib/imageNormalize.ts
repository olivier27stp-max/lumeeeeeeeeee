/* Client-side image normalization for logo/photo uploads.

   Users pick whatever their device produces (HEIC camera photos, huge PNGs).
   Storage and the public form need small, browser-displayable images — so
   convert anything the browser can decode into JPEG/PNG and downscale it,
   instead of rejecting the file with a cryptic validation error. */

const WEB_SAFE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/gif']);

export interface NormalizeOptions {
  /** Longest edge of the output image, in px. Default 1600. */
  maxDim?: number;
  /** Re-encode even web-safe formats when the file exceeds this size (MB). Default 5. */
  maxSizeMb?: number;
  /** JPEG/WebP quality (0-1). Default 0.9. */
  quality?: number;
}

async function decodeImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  try {
    return await createImageBitmap(file);
  } catch {
    // Some formats (or older browsers) fail createImageBitmap — try <img>.
    const url = URL.createObjectURL(file);
    try {
      return await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('decode failed'));
        img.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/**
 * Return a web-safe, reasonably-sized version of `file`.
 * - Already web-safe and small enough → returned untouched.
 * - Decodable by the browser (e.g. HEIC on Safari, oversized JPEG) → drawn to
 *   a canvas, downscaled to `maxDim`, re-encoded (PNG stays PNG for
 *   transparency, everything else becomes JPEG).
 * - Not decodable → throws a bilingual, user-displayable Error.
 */
export async function normalizeImageForUpload(file: File, options: NormalizeOptions = {}): Promise<File> {
  const { maxDim = 1600, maxSizeMb = 5, quality = 0.9 } = options;

  const withinSize = file.size <= maxSizeMb * 1024 * 1024;
  if (WEB_SAFE_TYPES.has(file.type) && withinSize) return file;
  // SVG is vector — rasterizing it would only lose quality; size is the only concern.
  if (file.type === 'image/svg+xml') {
    if (withinSize) return file;
    throw new Error(`SVG trop volumineux (max ${maxSizeMb} Mo). / SVG too large (max ${maxSizeMb} MB).`);
  }

  let source: ImageBitmap | HTMLImageElement;
  try {
    source = await decodeImage(file);
  } catch {
    throw new Error('Format d’image non pris en charge par ce navigateur — utilisez PNG ou JPG. / Image format not supported by this browser — use PNG or JPG.');
  }

  const srcW = 'naturalWidth' in source ? source.naturalWidth : source.width;
  const srcH = 'naturalHeight' in source ? source.naturalHeight : source.height;
  const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Conversion impossible. / Conversion failed.');
  ctx.drawImage(source, 0, 0, w, h);
  if ('close' in source) source.close();

  const keepPng = file.type === 'image/png';
  const outType = keepPng ? 'image/png' : 'image/jpeg';
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, outType, quality));
  if (!blob) throw new Error('Conversion impossible. / Conversion failed.');

  const baseName = file.name.replace(/\.[^.]+$/, '') || 'image';
  return new File([blob], `${baseName}.${keepPng ? 'png' : 'jpg'}`, { type: outType });
}
