// Pictures in notes (paste, drop, or / → Image). Images are shrunk on this
// device (longest side 1600 px, WebP) and saved inside the note, so they work
// offline and sync with it. A synced item can be about 1.5 MB, so a note keeps
// pictures up to about 1.3 MB in total; past that ProdLi asks for a new note.

export const MAX_IMAGE_SIDE = 1600;
export const TARGET_IMAGE_BYTES = 300_000;
export const MAX_NOTE_IMAGE_HTML = 1_300_000;
export const INSERT_IMAGE_EVENT = "prodli-insert-image";

const ALLOWED = /^image\/(png|jpe?g|webp|gif|avif|bmp)$/i;

export class NoteImageError extends Error {}

export const isNoteImage = (f: { type: string }) => ALLOWED.test(f.type);

/** Pure: the size to draw an image at so its longest side is at most `max`. */
export function fitWithin(width: number, height: number, max = MAX_IMAGE_SIDE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Pure: can a picture of `dataUrlLength` characters go into a note whose HTML is `noteHtmlLength` long? */
export const fitsInNote = (noteHtmlLength: number, dataUrlLength: number) => noteHtmlLength + dataUrlLength <= MAX_NOTE_IMAGE_HTML;

const readAsDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new NoteImageError("Couldn't read the picture."));
    r.readAsDataURL(blob);
  });

/** A picture file → a small data: URL for the note. */
export async function imageFileToDataUrl(file: Blob & { type: string }): Promise<string> {
  if (!isNoteImage(file)) throw new NoteImageError("Only pictures (PNG, JPG, WebP, GIF) can go in a note.");
  if (file.size > 25 * 1024 * 1024) throw new NoteImageError("That picture is over 25 MB.");
  // Small GIFs keep their animation.
  if (/gif/i.test(file.type) && file.size <= TARGET_IMAGE_BYTES) return readAsDataUrl(file);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new NoteImageError("ProdLi couldn't open that picture.");
  }
  let max = MAX_IMAGE_SIDE;
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const size = fitWithin(bitmap.width, bitmap.height, max);
      const canvas = document.createElement("canvas");
      canvas.width = size.width;
      canvas.height = size.height;
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0, size.width, size.height);
      for (const quality of [0.85, 0.72, 0.6]) {
        const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", quality));
        if (blob && blob.size <= TARGET_IMAGE_BYTES) return readAsDataUrl(blob);
      }
      max = Math.round(max * 0.7);
    }
  } finally {
    bitmap.close();
  }
  throw new NoteImageError("That picture is too detailed to fit in a note.");
}
