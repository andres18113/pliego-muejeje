package com.pliego.modules.catalog.api;

import java.util.List;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(name = "CatalogEditionSummaryResponse")
public record CatalogEditionSummaryResponse(String editionId, String bookId, String title, String authors,
        String publisher, String isbn13, String price, @Schema(nullable = true) String coverUrl,
        @Schema(nullable = true) String coverLicense,
        @Schema(nullable = true) String coverAttribution,
        @Schema(allowableValues = {"PAPERBACK", "HARDCOVER", "EBOOK", "AUDIOBOOK"}) String format, String language, boolean available, @Schema(nullable = true, allowableValues = {"EPUB", "PDF"}) String ebookFileFormat,
        @Schema(nullable = true) Integer audioDurationSeconds, List<String> narrators) {
}
