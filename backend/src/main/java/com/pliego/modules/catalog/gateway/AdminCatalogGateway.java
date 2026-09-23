package com.pliego.modules.catalog.gateway;

import com.pliego.modules.catalog.application.AdminCatalogModels.AuthorData;
import com.pliego.modules.catalog.application.AdminCatalogModels.AuthorRow;
import com.pliego.modules.catalog.application.AdminCatalogModels.BookData;
import com.pliego.modules.catalog.application.AdminCatalogModels.BookRow;
import com.pliego.modules.catalog.application.AdminCatalogModels.CategoryData;
import com.pliego.modules.catalog.application.AdminCatalogModels.CategoryRow;
import com.pliego.modules.catalog.application.AdminCatalogModels.EditionCreateData;
import com.pliego.modules.catalog.application.AdminCatalogModels.EditionRow;
import com.pliego.modules.catalog.application.AdminCatalogModels.EditionSearch;
import com.pliego.modules.catalog.application.AdminCatalogModels.EditionUpdateData;
import com.pliego.modules.catalog.application.AdminCatalogModels.Page;
import com.pliego.modules.catalog.application.AdminCatalogModels.PublisherData;
import com.pliego.modules.catalog.application.AdminCatalogModels.PublisherRow;
import com.pliego.modules.catalog.application.AdminCatalogModels.Search;

/** ADMIN catalog operations backed exclusively by the approved PostgreSQL Database API. */
public interface AdminCatalogGateway {

    Page<AuthorRow> searchAuthors(long actorId, Search query);
    Page<PublisherRow> searchPublishers(long actorId, Search query);
    Page<CategoryRow> searchCategories(long actorId, Search query);
    Page<BookRow> searchBooks(long actorId, Search query);
    Page<EditionRow> searchEditions(long actorId, EditionSearch query);

    long createAuthor(long actorId, AuthorData data);
    void updateAuthor(long actorId, long authorId, AuthorData data);
    void setAuthorStatus(long actorId, long authorId, String state);

    long createPublisher(long actorId, PublisherData data);
    void updatePublisher(long actorId, long publisherId, PublisherData data);
    void setPublisherStatus(long actorId, long publisherId, String state);

    long createCategory(long actorId, CategoryData data);
    void updateCategory(long actorId, long categoryId, CategoryData data);
    void setCategoryStatus(long actorId, long categoryId, String state);

    long createBook(long actorId, BookData data);
    void updateBook(long actorId, long bookId, BookData data);
    void setBookStatus(long actorId, long bookId, String state);

    long createEdition(long actorId, EditionCreateData data);
    void updateEdition(long actorId, long editionId, EditionUpdateData data);
    void setEditionStatus(long actorId, long editionId, String state);
}
