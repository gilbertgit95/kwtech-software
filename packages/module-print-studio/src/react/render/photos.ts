'use client';

import { isHeicFile, isPhotoFile, STUDIO_PHOTO_PIXELS_MAX } from '../view/work.js';

/**
 * A photo the person chose, decoded and held IN MEMORY ONLY.
 *
 * ⚠ NOTHING HERE TOUCHES THE NETWORK OR ANY STORAGE. The file is read by the
 * browser, decoded to pixels, and kept in this object until `releasePhoto`
 * (PRINT-STUDIO-PLAN decision 8).
 */
export interface StudioPhoto {
  /** Made here, for this session only. */
  id: string;
  /** The file's own name — what the print history records. */
  name: string;
  /** In pixels, AFTER the camera's rotation is applied. */
  width: number;
  height: number;
  /** Full resolution: what the result is drawn from. */
  bitmap: ImageBitmap;
  /** At most `PREVIEW_SIDE` on its long side: what the on-screen preview is drawn from. */
  preview: ImageBitmap;
  /** An object URL for the tray's thumbnail. Revoked by `releasePhoto`. */
  url: string;
}

/** The preview copy's long side, in pixels. Enough for a sharp on-screen sheet, a fraction of the memory. */
const PREVIEW_SIDE = 1600;

/**
 * Read one file as a photo.
 *
 * ⚠ `imageOrientation: 'from-image'` IS THE POINT OF THIS FUNCTION. A phone
 * stores a portrait photo as landscape pixels plus a "rotate me" tag; decoded
 * without it, every portrait ID photo comes out on its side.
 *
 * HEIC (an iPhone's own format) is decoded by `heic2any`, loaded only when one
 * is chosen — it is a megabyte of code nobody else needs.
 *
 * Throws a sentence for the person, never a stack: "… is not a photo the
 * studio can read."
 */
export async function loadPhoto(file: File): Promise<StudioPhoto> {
  if (!isPhotoFile(file)) throw new Error(`“${file.name}” is not a photo. Use JPG, PNG, WebP, GIF or HEIC.`);

  let blob: Blob = file;
  if (isHeicFile(file)) {
    try {
      const convert = heicConverter(await import('heic2any'));
      const converted = await convert({ blob: file, toType: 'image/jpeg', quality: 0.95 });
      blob = Array.isArray(converted) ? (converted[0] ?? file) : converted;
    } catch {
      throw new Error(`“${file.name}” could not be read. Try saving it as a JPG first.`);
    }
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    throw new Error(`“${file.name}” could not be read. It may be damaged, or not really a photo.`);
  }
  if (bitmap.width * bitmap.height > STUDIO_PHOTO_PIXELS_MAX) {
    bitmap.close();
    throw new Error(`“${file.name}” is too large to lay out. Use a photo under 80 megapixels.`);
  }

  const long = Math.max(bitmap.width, bitmap.height);
  const scale = Math.min(PREVIEW_SIDE / long, 1);
  const preview =
    scale === 1
      ? bitmap
      : await createImageBitmap(bitmap, {
          resizeWidth: Math.max(Math.round(bitmap.width * scale), 1),
          resizeHeight: Math.max(Math.round(bitmap.height * scale), 1),
          resizeQuality: 'high',
        });

  return {
    id: crypto.randomUUID(),
    name: file.name,
    width: bitmap.width,
    height: bitmap.height,
    bitmap,
    preview,
    url: URL.createObjectURL(blob),
  };
}

type HeicConverter = (options: { blob: Blob; toType: string; quality: number }) => Promise<Blob | Blob[]>;

/**
 * `heic2any` is a CommonJS bundle, and what a dynamic import hands back for
 * one depends on who bundled the app: the function itself, or a namespace with
 * it under `default` (once or twice). Found structurally rather than trusted.
 */
function heicConverter(loaded: unknown): HeicConverter {
  let candidate = loaded;
  for (let depth = 0; depth < 3; depth += 1) {
    if (typeof candidate === 'function') return candidate as HeicConverter;
    if (typeof candidate !== 'object' || candidate === null) break;
    candidate = (candidate as { default?: unknown }).default;
  }
  throw new Error('The HEIC reader did not load.');
}

/** Let go of a photo's pixels and its thumbnail. After this the object must not be drawn. */
export function releasePhoto(photo: StudioPhoto): void {
  URL.revokeObjectURL(photo.url);
  if (photo.preview !== photo.bitmap) photo.preview.close();
  photo.bitmap.close();
}
