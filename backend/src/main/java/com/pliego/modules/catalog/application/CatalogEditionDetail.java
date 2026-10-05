package com.pliego.modules.catalog.application;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

public record CatalogEditionDetail(String editionId, String bookId, String title, String subtitle,
        String synopsis, List<Author> authors, List<Category> categories, Publisher publisher,
        String isbn13, String sku, String language, String format, Integer pageCount,
        LocalDate publicationDate, BigDecimal price, String coverUrl, String coverLicense,
        String coverSourceUrl, String coverAttribution, boolean available, String ebookFileFormat, Integer audioDurationSeconds, List<String> narrators, CatalogOffer offer) {

    public CatalogEditionDetail(String editionId, String bookId, String title, String subtitle,
        String synopsis, List<Author> authors, List<Category> categories, Publisher publisher,
        String isbn13, String sku, String language, String format, Integer pageCount,
        LocalDate publicationDate, BigDecimal price, String coverUrl, String coverLicense,
        String coverSourceUrl, String coverAttribution, boolean available, String ebookFileFormat, Integer audioDurationSeconds, List<String> narrators) {
        this(editionId, bookId, title, subtitle, synopsis, authors, categories, publisher, isbn13, sku, language, format, pageCount, publicationDate, price, coverUrl, coverLicense, coverSourceUrl, coverAttribution, available, ebookFileFormat, audioDurationSeconds, narrators, null);
    }

    public CatalogEditionDetail {
        authors = List.copyOf(authors);
        categories = List.copyOf(categories);
        narrators = List.copyOf(narrators);
    }

    public record Author(String authorId, String name, int order) {
    }

    public record Category(String categoryId, String name, String slug, String parentCategoryId) {
    }

    public record Publisher(String publisherId, String name) {
    }
}
