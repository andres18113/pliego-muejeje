package com.pliego.modules.catalog.application;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

/** Application inputs and read models shared by the service and its JDBC adapter. */
public final class AdminCatalogModels {
    private AdminCatalogModels() { }

    public record Search(String query, String state, int page, int pageSize) { }
    public record EditionSearch(String query, String state, Long bookId, int page, int pageSize) { }
    public record Page<T>(List<T> items, long totalCount) {
        public Page { items = List.copyOf(items); }
    }

    public record AuthorRow(String authorId, String name, String biography, String state,
            String createdAt, String updatedAt) { }
    public record PublisherRow(String publisherId, String name, String description, String state,
            String createdAt, String updatedAt) { }
    public record CategoryRow(String categoryId, String parentCategoryId, String parentName, String name,
            String slug, String description, String state, String createdAt, String updatedAt) { }
    public record BookAuthor(String authorId, String name, int order) { }
    public record BookCategory(String categoryId, String name, String slug) { }
    public record BookRow(String bookId, String title, String subtitle, String synopsis, String state,
            List<BookAuthor> authors, List<BookCategory> categories, String createdAt, String updatedAt) {
        public BookRow { authors = List.copyOf(authors); categories = List.copyOf(categories); }
    }
    public record EditionRow(String editionId, String bookId, String bookTitle, String publisherId,
            String publisherName, String sku, String isbn13, String language, String format,
            Integer pageCount, LocalDate publicationDate, BigDecimal price, String coverUrl,
            String coverLicense, String coverSourceUrl, String coverAttribution, String state,
            int stockActual, String createdAt, String updatedAt) { }

    public record AuthorData(String name, String biography) { }
    public record PublisherData(String name, String description) { }
    public record CategoryData(String name, String slug, String description, Long parentCategoryId) { }
    public record BookData(String title, String subtitle, String synopsis, List<BookAuthorInput> authors,
            List<Long> categoryIds) {
        public BookData { authors = List.copyOf(authors); categoryIds = List.copyOf(categoryIds); }
    }
    public record BookAuthorInput(long authorId, int order) { }
    public record EditionCreateData(long bookId, long publisherId, String sku, String isbn13, String language,
            String format, int pageCount, LocalDate publicationDate, BigDecimal price, String coverUrl,
            String coverLicense, String coverSourceUrl, String coverAttribution) { }
    public record EditionUpdateData(long publisherId, String isbn13, String language, String format,
            int pageCount, LocalDate publicationDate, BigDecimal price, String coverUrl,
            String coverLicense, String coverSourceUrl, String coverAttribution) { }
}
