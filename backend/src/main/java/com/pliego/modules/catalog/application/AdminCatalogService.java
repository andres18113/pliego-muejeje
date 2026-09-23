package com.pliego.modules.catalog.application;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.pliego.modules.catalog.gateway.AdminCatalogGateway;
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

/** Coordinates the ADMIN catalog use cases; PostgreSQL owns their business invariants. */
@Service
public class AdminCatalogService {

    private final AdminCatalogGateway gateway;

    public AdminCatalogService(AdminCatalogGateway gateway) {
        this.gateway = gateway;
    }

    @Transactional(readOnly = true)
    public Page<AuthorRow> searchAuthors(long actorId, Search query) {
        return gateway.searchAuthors(actorId, query);
    }

    @Transactional(readOnly = true)
    public Page<PublisherRow> searchPublishers(long actorId, Search query) {
        return gateway.searchPublishers(actorId, query);
    }

    @Transactional(readOnly = true)
    public Page<CategoryRow> searchCategories(long actorId, Search query) {
        return gateway.searchCategories(actorId, query);
    }

    @Transactional(readOnly = true)
    public Page<BookRow> searchBooks(long actorId, Search query) {
        return gateway.searchBooks(actorId, query);
    }

    @Transactional(readOnly = true)
    public Page<EditionRow> searchEditions(long actorId, EditionSearch query) {
        return gateway.searchEditions(actorId, query);
    }

    @Transactional
    public long createAuthor(long actorId, AuthorData data) { return gateway.createAuthor(actorId, data); }
    @Transactional
    public void updateAuthor(long actorId, long id, AuthorData data) { gateway.updateAuthor(actorId, id, data); }
    @Transactional
    public void setAuthorStatus(long actorId, long id, String state) { gateway.setAuthorStatus(actorId, id, state); }

    @Transactional
    public long createPublisher(long actorId, PublisherData data) { return gateway.createPublisher(actorId, data); }
    @Transactional
    public void updatePublisher(long actorId, long id, PublisherData data) { gateway.updatePublisher(actorId, id, data); }
    @Transactional
    public void setPublisherStatus(long actorId, long id, String state) { gateway.setPublisherStatus(actorId, id, state); }

    @Transactional
    public long createCategory(long actorId, CategoryData data) { return gateway.createCategory(actorId, data); }
    @Transactional
    public void updateCategory(long actorId, long id, CategoryData data) { gateway.updateCategory(actorId, id, data); }
    @Transactional
    public void setCategoryStatus(long actorId, long id, String state) { gateway.setCategoryStatus(actorId, id, state); }

    @Transactional
    public long createBook(long actorId, BookData data) { return gateway.createBook(actorId, data); }
    @Transactional
    public void updateBook(long actorId, long id, BookData data) { gateway.updateBook(actorId, id, data); }
    @Transactional
    public void setBookStatus(long actorId, long id, String state) { gateway.setBookStatus(actorId, id, state); }

    @Transactional
    public long createEdition(long actorId, EditionCreateData data) { return gateway.createEdition(actorId, data); }
    @Transactional
    public void updateEdition(long actorId, long id, EditionUpdateData data) { gateway.updateEdition(actorId, id, data); }
    @Transactional
    public void setEditionStatus(long actorId, long id, String state) { gateway.setEditionStatus(actorId, id, state); }
}
