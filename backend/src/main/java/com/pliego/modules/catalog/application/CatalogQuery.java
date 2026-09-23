package com.pliego.modules.catalog.application;

import java.math.BigDecimal;

public record CatalogQuery(String title, String author, String isbn13, String category,
        BigDecimal minPrice, BigDecimal maxPrice, String language, String format, String sort,
        int page, int pageSize) {
}
