package com.pliego.modules.catalog.api;

import java.util.List;

/** Wire representations for ADMIN catalog resources. IDs and totals stay decimal strings. */
public final class AdminCatalogResponses {
    private AdminCatalogResponses() { }

    public record AuthorCreated(String authorId) { }
    public record PublisherCreated(String publisherId) { }
    public record CategoryCreated(String categoryId) { }
    public record BookCreated(String bookId) { }
    public record EditionCreated(String editionId) { }

    public record Author(String authorId, String name, String biography, String state,
            String createdAt, String updatedAt) { }
    public record Publisher(String publisherId, String name, String description, String state,
            String createdAt, String updatedAt) { }
    public record Category(String categoryId, String parentCategoryId, String parentName, String name,
            String slug, String description, String state, String createdAt, String updatedAt) { }
    public record BookAuthor(String authorId, String name, int order) { }
    public record BookCategory(String categoryId, String name, String slug) { }
    public record Book(String bookId, String title, String subtitle, String synopsis, String state,
            List<BookAuthor> authors, List<BookCategory> categories, String createdAt, String updatedAt) { }
    public record Edition(String editionId, String bookId, String bookTitle, String publisherId,
            String publisherName, String sku, String isbn13, String language, String format,
            Integer pageCount, String publicationDate, String price, String coverUrl,
            String coverLicense, String coverSourceUrl, String coverAttribution, String state,
            int stockActual, String createdAt, String updatedAt) { }
}
