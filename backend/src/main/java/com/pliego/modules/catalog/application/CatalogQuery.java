package com.pliego.modules.catalog.application;

import java.math.BigDecimal;

public record CatalogQuery(String query, String title, String author, String isbn13, String category,
        BigDecimal minPrice, BigDecimal maxPrice, String language, String format, String sort,
        int page, int pageSize, boolean offersOnly, String productType) {
    public CatalogQuery(String query, String title, String author, String isbn13, String category,
            BigDecimal minPrice, BigDecimal maxPrice, String language, String format, String sort,
            int page, int pageSize) {
        this(query, title, author, isbn13, category, minPrice, maxPrice, language, format, sort, page, pageSize, false, null);
    }
}
