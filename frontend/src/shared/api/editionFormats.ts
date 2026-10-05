import { z } from "zod";

/** The additive V032 format contract shared by catalog, favorites and cart reads. */
export const editionFormats = ["PAPERBACK", "HARDCOVER", "EBOOK", "AUDIOBOOK"] as const;
export const editionFormatSchema = z.enum(editionFormats);
export type EditionFormat = z.infer<typeof editionFormatSchema>;
export function isDigitalFormat(format: string | null | undefined) {
  return format === "EBOOK" || format === "AUDIOBOOK";
}

/** Older physical responses can omit these fields; current API sends null/empty values. */
export const digitalMetadataFields = {
  ebookFileFormat: z.enum(["EPUB", "PDF"]).nullable().optional(),
  audioDurationSeconds: z.number().int().positive().max(2_147_483_647).nullable().optional(),
  narrators: z.array(z.string().max(200).regex(/\S/)).max(32).optional(),
};

export function validateDigitalMetadata(
  data: { format?: EditionFormat; ebookFileFormat?: "EPUB" | "PDF" | null; audioDurationSeconds?: number | null; narrators?: string[] },
  context: z.RefinementCtx,
) {
  if (data.format === "AUDIOBOOK") {
    if (!data.audioDurationSeconds || !data.narrators?.length || data.ebookFileFormat != null) {
      context.addIssue({ code: "custom", message: "Los metadatos del audiolibro están incompletos." });
    }
  } else if (data.format) {
    if (data.audioDurationSeconds != null || data.narrators?.length || (data.format !== "EBOOK" && data.ebookFileFormat != null)) {
      context.addIssue({ code: "custom", message: "Los metadatos digitales no corresponden al formato." });
    }
  }
}
