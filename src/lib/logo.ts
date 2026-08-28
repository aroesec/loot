/**
 * Validation for a business logo upload.
 *
 * DB-free, like `tax-math.ts` and `dates.ts` — the mime/size checks are worth
 * testing without a database, and the caller (a server action) does the
 * actual base64 encoding and storage.
 *
 * No runtime image processing happens anywhere in this app (`pnpm icons`
 * shells out to `sharp`, but only at build time, committed to `public/` —
 * see `src/db/icons.ts`). A logo is stored and shown exactly as uploaded, so
 * the only gate is mime type and size.
 */

export const LOGO_ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

/** A logo, not a statement — kept far below the 12MB statement ceiling. */
export const LOGO_MAX_BYTES = 1 * 1024 * 1024;

export type LogoValidation = { ok: true } | { ok: false; message: string };

export function validateLogo(mimeType: string, byteSize: number): LogoValidation {
  if (!LOGO_ALLOWED_MIME_TYPES.includes(mimeType as (typeof LOGO_ALLOWED_MIME_TYPES)[number])) {
    return {
      ok: false,
      message: "Logo must be a PNG, JPEG, or WebP image.",
    };
  }
  if (byteSize > LOGO_MAX_BYTES) {
    return { ok: false, message: "Logo must be 1MB or smaller." };
  }
  return { ok: true };
}
