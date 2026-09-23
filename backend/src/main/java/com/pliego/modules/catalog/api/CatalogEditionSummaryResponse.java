package com.pliego.modules.catalog.api;

public record CatalogEditionSummaryResponse(String editionId, String bookId, String title, String authors,
        String publisher, String isbn13, String price, String coverUrl, String coverLicense,
        String coverAttribution, String format, String language, boolean available) {
}
