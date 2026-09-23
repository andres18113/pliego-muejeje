package com.pliego.modules.catalog.application;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

public record CatalogEditionDetail(String editionId, String bookId, String title, String subtitle,
        String synopsis, List<Author> authors, List<Category> categories, Publisher publisher,
        String isbn13, String sku, String language, String format, Integer pageCount,
        LocalDate publicationDate, BigDecimal price, String coverUrl, String coverLicense,
        String coverSourceUrl, String coverAttribution, boolean available) {

    public CatalogEditionDetail {
        authors = List.copyOf(authors);
        categories = List.copyOf(categories);
    }

    public record Author(String authorId, String name, int order) {
    }

    public record Category(String categoryId, String name, String slug, String parentCategoryId) {
    }

    public record Publisher(String publisherId, String name) {
    }
}
