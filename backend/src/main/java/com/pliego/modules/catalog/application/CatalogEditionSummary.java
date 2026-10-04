package com.pliego.modules.catalog.application;

import java.util.List;

import java.math.BigDecimal;

public record CatalogEditionSummary(String editionId, String bookId, String title, String authors,
        String publisher, String isbn13, BigDecimal price, String coverUrl, String coverLicense,
        String coverAttribution, String format, String language, boolean available, String ebookFileFormat, Integer audioDurationSeconds, List<String> narrators) {
    public CatalogEditionSummary { narrators = List.copyOf(narrators); }
}
