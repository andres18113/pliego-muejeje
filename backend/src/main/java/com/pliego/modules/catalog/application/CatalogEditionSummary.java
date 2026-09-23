package com.pliego.modules.catalog.application;

import java.math.BigDecimal;

public record CatalogEditionSummary(String editionId, String bookId, String title, String authors,
        String publisher, String isbn13, BigDecimal price, String coverUrl, String coverLicense,
        String coverAttribution, String format, String language, boolean available) {
}
