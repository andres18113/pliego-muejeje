import { describe, expect, it } from "vitest";
import type { FavoriteEdition } from "@/shared/api/favorites";
import { toBookCardData, bookCardNavigationState } from "./bookCardModel";

const favorite: FavoriteEdition = { editionId: "9223372036854775807", bookId: "17", title: "Introducción al álgebra lineal", authors: "José Alfredo Collazos Sánchez, Carlos Alberto Ramírez Vanegas, Óscar Danilo Montoya Giraldo", publisher: "Ecoe Ediciones", price: "999999999.99", coverUrl: null, coverLicense: null, coverAttribution: null, format: "PAPERBACK", language: "es", available: false, favoritedAt: "2026-10-01T12:00:00Z" };

describe("BookCard edition presentation adapter", () => {
  it("consumes the common favorite projection without synthesizing ISBN or losing money/ID precision", () => {
    const book = toBookCardData(favorite);
    expect(book.id).toBe("9223372036854775807");
    expect(book.priceLabel).toMatch(/999\.999\.999,99/);
    expect(book.authors).toBe(favorite.authors);
    expect(book.editionLabel).toBe("Rústica · Español");
    expect(book.available).toBe(false);
    expect(book).not.toHaveProperty("isbn13"); expect(book).not.toHaveProperty("bookId");
  });
  it("preserves received cover provenance in the existing navigation snapshot", () => {
    const book = toBookCardData({ ...favorite, coverUrl: "https://covers.example.invalid/book.webp", coverLicense: "Licencia de prueba", coverAttribution: "Crédito técnico" });
    expect(bookCardNavigationState(book, true)).toEqual({ catalogReturn: true, coverPreview: { editionId: favorite.editionId, url: book.cover.url, license: "Licencia de prueba", attribution: "Crédito técnico", title: favorite.title } });
    expect(bookCardNavigationState(book)).not.toHaveProperty("catalogReturn");
    expect(bookCardNavigationState(book, false, "audiobook").coverPreview).toMatchObject({ editionId: favorite.editionId, media: "audiobook" });
    expect(bookCardNavigationState(book).coverPreview).not.toHaveProperty("media");
  });
});
