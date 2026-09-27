package com.pliego.modules.catalog.api;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(name = "CatalogEditionSummaryResponse")
public record CatalogEditionSummaryResponse(String editionId, String bookId, String title, String authors,
        String publisher, String isbn13, String price, @Schema(nullable = true) String coverUrl,
        @Schema(nullable = true) String coverLicense,
        @Schema(nullable = true) String coverAttribution,
        String format, String language, boolean available) {
}
