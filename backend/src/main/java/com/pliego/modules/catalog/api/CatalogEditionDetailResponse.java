package com.pliego.modules.catalog.api;

import java.util.List;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(name = "CatalogEditionDetailResponse")
public record CatalogEditionDetailResponse(String editionId, String bookId, String title, String subtitle,
        @Schema(nullable = true) String synopsis, List<Author> authors, List<Category> categories, Publisher publisher,
        String isbn13, String sku, String language, String format, Integer pageCount,
        String publicationDate, String price, @Schema(nullable = true) String coverUrl,
        @Schema(nullable = true) String coverLicense,
        @Schema(nullable = true) String coverSourceUrl,
        @Schema(nullable = true) String coverAttribution,
        boolean available) {

    public record Author(String authorId, String name, int order) {
    }

    public record Category(String categoryId, String name, String slug, String parentCategoryId) {
    }

    public record Publisher(String publisherId, String name) {
    }
}
