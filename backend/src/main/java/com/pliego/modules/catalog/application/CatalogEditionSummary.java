package com.pliego.modules.catalog.application;

import java.util.List;

import java.math.BigDecimal;

public record CatalogEditionSummary(String editionId, String bookId, String title, String authors,
        String publisher, String isbn13, BigDecimal price, String coverUrl, String coverLicense,
        String coverAttribution, String format, String language, boolean available, String ebookFileFormat, Integer audioDurationSeconds, List<String> narrators, CatalogOffer offer) {

    public CatalogEditionSummary(String editionId, String bookId, String title, String authors,
        String publisher, String isbn13, BigDecimal price, String coverUrl, String coverLicense,
        String coverAttribution, String format, String language, boolean available, String ebookFileFormat, Integer audioDurationSeconds, List<String> narrators) {
        this(editionId, bookId, title, authors, publisher, isbn13, price, coverUrl, coverLicense, coverAttribution, format, language, available, ebookFileFormat, audioDurationSeconds, narrators, null);
    }
    public CatalogEditionSummary { narrators = List.copyOf(narrators); }
}
