package com.pliego.modules.catalog.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.math.BigDecimal;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.SimpleTransactionStatus;

import com.pliego.foundation.database.DatabaseException;
import com.pliego.foundation.database.DatabaseExceptionTranslator;
import com.pliego.foundation.security.JwtTokenIssuer;
import static com.pliego.modules.catalog.application.AdminCatalogModels.*;
import com.pliego.modules.catalog.gateway.AdminCatalogGateway;

@SpringBootTest(properties = {
        "spring.datasource.url=jdbc:postgresql://localhost:5432/pliego_i5_test",
        "spring.datasource.username=pliego_test",
        "spring.datasource.password=pliego_test",
        "spring.flyway.enabled=false",
        "PLIEGO_ADMIN_EMAIL=admin@example.com",
        "PLIEGO_ADMIN_PASSWORD_HASH=unused",
        "PLIEGO_JWT_SECRET=0123456789abcdef0123456789abcdef",
        "pliego.cors.allowed-origins="
})
@AutoConfigureMockMvc
@Import(AdminCatalogApiIntegrationTest.TestConfigurationForAdminCatalog.class)
class AdminCatalogApiIntegrationTest {

    private static final String AUTHOR = "{\"name\":\"George Orwell\",\"biography\":\"Novelista\"}";
    private static final String PUBLISHER = "{\"name\":\"Penguin Books\",\"description\":null}";
    private static final String CATEGORY = "{\"name\":\"Literatura\",\"slug\":\"literatura\",\"description\":null,\"parentCategoryId\":null}";
    private static final String BOOK = "{\"title\":\"1984\",\"subtitle\":null,\"synopsis\":\"Novela\",\"authors\":[{\"authorId\":\"15\",\"order\":2},{\"authorId\":\"16\",\"order\":1}],\"categoryIds\":[\"2\",\"7\"]}";
    private static final String EDITION = "{\"bookId\":\"90\",\"publisherId\":\"8\",\"sku\":\"PLG-LIT-001\",\"isbn13\":\"9780306406157\",\"language\":\"es\",\"format\":\"PAPERBACK\",\"pageCount\":328,\"publicationDate\":\"2024-01-15\",\"price\":\"18.50\",\"coverUrl\":\"https://example.com/cover.jpg\",\"coverLicense\":\"CC_BY\",\"coverSourceUrl\":\"https://example.com/source\",\"coverAttribution\":\"Editorial\"}";
    private static final String EDITION_UPDATE = "{\"publisherId\":\"8\",\"isbn13\":\"9780306406157\",\"language\":\"es\",\"format\":\"PAPERBACK\",\"pageCount\":328,\"publicationDate\":\"2024-01-15\",\"price\":\"19.90\",\"coverUrl\":null,\"coverLicense\":null,\"coverSourceUrl\":null,\"coverAttribution\":null}";

    @Autowired MockMvc mvc;
    @Autowired JwtTokenIssuer tokenIssuer;
    @Autowired DatabaseExceptionTranslator exceptionTranslator;
    @Autowired FakeAdminCatalogGateway gateway;

    @BeforeEach void resetGateway() { gateway.reset(); }

    @Test
    void allFiveSearchesRequireAdminAndUseDefaultPagination() throws Exception {
        for (String resource : List.of("authors", "publishers", "categories", "books", "editions")) {
            mvc.perform(get("/api/v1/admin/" + resource).header("Authorization", adminToken("17")))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.page").value(0))
                    .andExpect(jsonPath("$.pageSize").value(20)).andExpect(jsonPath("$.totalCount").value("0"));
        }
        assertEquals(5, gateway.searchCalls);
        assertEquals(17L, gateway.lastActorId);

        mvc.perform(get("/api/v1/admin/authors")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/admin/authors").header("Authorization", customerToken("42")))
                .andExpect(status().isForbidden());
    }

    @Test
    void searchesPassContractFiltersAndPaginationToTheirFunctionGateway() throws Exception {
        String admin = adminToken("17");
        for (String resource : List.of("authors", "publishers", "categories", "books")) {
            mvc.perform(get("/api/v1/admin/" + resource).header("Authorization", admin)
                            .param("query", "Cervantes").param("state", "INACTIVE").param("page", "3").param("pageSize", "7"))
                    .andExpect(status().isOk());
            assertEquals(new Search("Cervantes", "INACTIVE", 3, 7), gateway.lastSearch);
        }
        mvc.perform(get("/api/v1/admin/editions").header("Authorization", admin)
                        .param("query", "PLG-LIT").param("state", "ACTIVE").param("bookId", "90")
                        .param("page", "2").param("pageSize", "5"))
                .andExpect(status().isOk());
        assertEquals(new EditionSearch("PLG-LIT", "ACTIVE", 90L, 2, 5), gateway.lastEditionSearch);
    }

    @Test
    void createsReplacesAndChangesStatusForEveryCatalogResource() throws Exception {
        String admin = adminToken("17");
        mvc.perform(post("/api/v1/admin/authors").header("Authorization", admin).contentType(MediaType.APPLICATION_JSON).content(AUTHOR))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.authorId").value("501"));
        mvc.perform(put("/api/v1/admin/authors/501").header("Authorization", admin).contentType(MediaType.APPLICATION_JSON).content(AUTHOR))
                .andExpect(status().isNoContent());
        changeStatus(admin, "authors", 501);
        assertEquals(new AuthorData("George Orwell", "Novelista"), gateway.lastAuthorData);

        mvc.perform(post("/api/v1/admin/publishers").header("Authorization", admin).contentType(MediaType.APPLICATION_JSON).content(PUBLISHER))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.publisherId").value("502"));
        mvc.perform(put("/api/v1/admin/publishers/502").header("Authorization", admin).contentType(MediaType.APPLICATION_JSON).content(PUBLISHER))
                .andExpect(status().isNoContent());
        changeStatus(admin, "publishers", 502);
        assertEquals(new PublisherData("Penguin Books", null), gateway.lastPublisherData);

        mvc.perform(post("/api/v1/admin/categories").header("Authorization", admin).contentType(MediaType.APPLICATION_JSON).content(CATEGORY))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.categoryId").value("503"));
        String child = CATEGORY.replace("Literatura", "Fantasía").replace("literatura", "fantasia")
                .replace("\"parentCategoryId\":null", "\"parentCategoryId\":\"2\"");
        mvc.perform(post("/api/v1/admin/categories").header("Authorization", admin).contentType(MediaType.APPLICATION_JSON).content(child))
                .andExpect(status().isCreated());
        assertEquals(2L, gateway.lastCategoryData.parentCategoryId());
        mvc.perform(put("/api/v1/admin/categories/503").header("Authorization", admin).contentType(MediaType.APPLICATION_JSON).content(CATEGORY))
                .andExpect(status().isNoContent());
        changeStatus(admin, "categories", 503);
        assertEquals(new CategoryData("Literatura", "literatura", null, null), gateway.lastCategoryData);

        mvc.perform(post("/api/v1/admin/books").header("Authorization", admin).contentType(MediaType.APPLICATION_JSON).content(BOOK))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.bookId").value("504"));
        mvc.perform(put("/api/v1/admin/books/504").header("Authorization", admin).contentType(MediaType.APPLICATION_JSON).content(BOOK))
                .andExpect(status().isNoContent());
        changeStatus(admin, "books", 504);
        assertEquals(List.of(new BookAuthorInput(15, 2), new BookAuthorInput(16, 1)), gateway.lastBookData.authors());
        assertEquals(List.of(2L, 7L), gateway.lastBookData.categoryIds());

        mvc.perform(post("/api/v1/admin/editions").header("Authorization", admin).contentType(MediaType.APPLICATION_JSON).content(EDITION))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.editionId").value("505"));
        mvc.perform(put("/api/v1/admin/editions/505").header("Authorization", admin).contentType(MediaType.APPLICATION_JSON).content(EDITION_UPDATE))
                .andExpect(status().isNoContent());
        changeStatus(admin, "editions", 505);
        assertEquals(new BigDecimal("18.50"), gateway.lastEditionCreate.price());
        assertEquals(LocalDate.of(2024, 1, 15), gateway.lastEditionCreate.publicationDate());
        assertEquals(new BigDecimal("19.90"), gateway.lastEditionUpdate.price());
    }

    @Test
    void updateBookPassesFullReplacementListsIncludingInactiveAssociations() throws Exception {
        mvc.perform(put("/api/v1/admin/books/90").header("Authorization", adminToken("17"))
                        .contentType(MediaType.APPLICATION_JSON).content(BOOK))
                .andExpect(status().isNoContent());
        assertEquals(List.of(new BookAuthorInput(15, 2), new BookAuthorInput(16, 1)), gateway.lastBookData.authors());
        assertEquals(List.of(2L, 7L), gateway.lastBookData.categoryIds());
        assertEquals("updateBook", gateway.lastCall);
    }

    @Test
    void adminEditionSearchSerializesIdsMoneyAndDateAsContractStrings() throws Exception {
        gateway.editionPage = new Page<>(List.of(new EditionRow("250", "90", "1984", "8", "Penguin",
                "PLG-LIT-001", "9780306406157", "es", "PAPERBACK", 328, LocalDate.of(2024, 1, 15),
                new BigDecimal("18.50"), null, null, null, null, "ACTIVE", 4,
                "2024-01-15T10:00:00Z", "2024-01-15T10:00:00Z")), 1);
        String body = mvc.perform(get("/api/v1/admin/editions").header("Authorization", adminToken("17")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.items[0].editionId").value("250"))
                .andExpect(jsonPath("$.items[0].bookId").value("90"))
                .andExpect(jsonPath("$.items[0].publisherId").value("8"))
                .andExpect(jsonPath("$.items[0].price").value("18.50"))
                .andExpect(jsonPath("$.items[0].publicationDate").value("2024-01-15"))
                .andExpect(jsonPath("$.items[0].stockActual").value(4))
                .andReturn().getResponse().getContentAsString();
        assertTrue(body.contains("\"editionId\":\"250\""));
        assertFalse(body.contains("18.5\""));
    }

    @Test
    void bookSearchPreservesDatabaseAuthorOrderAndStringIdentifiers() throws Exception {
        gateway.bookPage = new Page<>(List.of(new BookRow("90", "1984", null, "Novela", "ACTIVE",
                List.of(new BookAuthor("15", "George Orwell", 1), new BookAuthor("16", "Editor", 2)),
                List.of(new BookCategory("2", "Literatura", "literatura")),
                "2024-01-15T10:00:00Z", "2024-01-15T10:00:00Z")), 1);
        mvc.perform(get("/api/v1/admin/books").header("Authorization", adminToken("17")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.items[0].bookId").value("90"))
                .andExpect(jsonPath("$.items[0].authors[0].authorId").value("15"))
                .andExpect(jsonPath("$.items[0].authors[0].order").value(1))
                .andExpect(jsonPath("$.items[0].authors[1].authorId").value("16"))
                .andExpect(jsonPath("$.items[0].categories[0].categoryId").value("2"));
    }

    @Test
    void invalidSearchAndPaginationReturnSpanishProblems() throws Exception {
        for (var pair : List.of(new String[] {"state", "BLOCKED"}, new String[] {"page", "-1"},
                new String[] {"pageSize", "51"}, new String[] {"bookId", "0"})) {
            mvc.perform(get("/api/v1/admin/editions").header("Authorization", adminToken("17"))
                            .param(pair[0], pair[1]))
                    .andExpect(status().isBadRequest()).andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                    .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                    .andExpect(jsonPath("$.title").value("Datos inválidos"))
                    .andExpect(jsonPath("$.detail").value("Revisa los filtros enviados e intenta nuevamente."));
        }
    }

    @Test
    void immutableEditionFieldsAndMalformedRequestsAreRejectedWithoutCallingDatabase() throws Exception {
        mvc.perform(put("/api/v1/admin/editions/505").header("Authorization", adminToken("17"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(EDITION_UPDATE.replace("\"publisherId\"", "\"bookId\":\"90\",\"publisherId\"").replace("\"isbn13\"", "\"sku\":\"NEW\",\"isbn13\"")))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("MALFORMED_JSON"));
        mvc.perform(post("/api/v1/admin/editions").header("Authorization", adminToken("17"))
                        .contentType(MediaType.APPLICATION_JSON).content(EDITION.replace("18.50", "18.5")))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.title").value("Datos inválidos"))
                .andExpect(jsonPath("$.violations[0].message").value("El precio debe tener dos posiciones decimales."));
        assertEquals(0, gateway.mutationCalls);
    }

    @Test
    void databaseRoutineErrorsHaveStableCodesAndSafeSpanishFeedback() throws Exception {
        gateway.failure = databaseFailure("P2012");
        String inactivePublisher = mvc.perform(post("/api/v1/admin/editions").header("Authorization", adminToken("17"))
                        .contentType(MediaType.APPLICATION_JSON).content(EDITION))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("P2012"))
                .andExpect(jsonPath("$.title").value("Editorial no disponible"))
                .andExpect(jsonPath("$.detail").value("La editorial no está disponible para esta operación."))
                .andReturn().getResponse().getContentAsString();
        assertFalse(inactivePublisher.contains("private postgres"));

        gateway.failure = databaseFailure("P2023");
        mvc.perform(put("/api/v1/admin/categories/3").header("Authorization", adminToken("17"))
                        .contentType(MediaType.APPLICATION_JSON).content(CATEGORY))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("P2023"))
                .andExpect(jsonPath("$.title").value("Jerarquía de categorías inválida"));
        gateway.failure = databaseFailure("P2024");
        mvc.perform(post("/api/v1/admin/categories").header("Authorization", adminToken("17"))
                        .contentType(MediaType.APPLICATION_JSON).content(CATEGORY))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("P2024"))
                .andExpect(jsonPath("$.detail").value("Ya existe una categoría con ese identificador."));

        gateway.failure = databaseFailure("P2032");
        mvc.perform(post("/api/v1/admin/books").header("Authorization", adminToken("17"))
                        .contentType(MediaType.APPLICATION_JSON).content(BOOK))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("P2032"))
                .andExpect(jsonPath("$.detail").value("El libro debe tener al menos un autor."));
        gateway.failure = databaseFailure("P2002");
        mvc.perform(post("/api/v1/admin/books").header("Authorization", adminToken("17"))
                        .contentType(MediaType.APPLICATION_JSON).content(BOOK))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.title").value("Autor no disponible"));
        gateway.failure = databaseFailure("P2022");
        mvc.perform(post("/api/v1/admin/books").header("Authorization", adminToken("17"))
                        .contentType(MediaType.APPLICATION_JSON).content(BOOK))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.title").value("Categoría no disponible"));

        gateway.failure = databaseFailure("P2044");
        mvc.perform(post("/api/v1/admin/editions").header("Authorization", adminToken("17"))
                        .contentType(MediaType.APPLICATION_JSON).content(EDITION))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.detail").value("Ya existe una edición con ese SKU."));
        gateway.failure = databaseFailure("P2046");
        mvc.perform(post("/api/v1/admin/editions").header("Authorization", adminToken("17"))
                        .contentType(MediaType.APPLICATION_JSON).content(EDITION))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.detail").value("El ISBN no es válido."));
        gateway.failure = databaseFailure("P2045");
        mvc.perform(post("/api/v1/admin/editions").header("Authorization", adminToken("17"))
                        .contentType(MediaType.APPLICATION_JSON).content(EDITION))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.title").value("ISBN ya registrado"));
        gateway.failure = databaseFailure("P2047");
        mvc.perform(post("/api/v1/admin/editions").header("Authorization", adminToken("17"))
                        .contentType(MediaType.APPLICATION_JSON).content(EDITION))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.title").value("Datos de portada inválidos"));
        gateway.failure = databaseFailure("P2048");
        mvc.perform(post("/api/v1/admin/editions").header("Authorization", adminToken("17"))
                        .contentType(MediaType.APPLICATION_JSON).content(EDITION))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.title").value("Datos de edición inválidos"));
    }

    @Test
    void emptyBookAssociationsAreSentToPostgresForApprovedInvariantErrors() throws Exception {
        String empty = "{\"title\":\"1984\",\"subtitle\":null,\"synopsis\":null,\"authors\":[],\"categoryIds\":[]}";
        gateway.failure = databaseFailure("P2032");
        mvc.perform(post("/api/v1/admin/books").header("Authorization", adminToken("17"))
                        .contentType(MediaType.APPLICATION_JSON).content(empty))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("P2032"));
        assertEquals("createBook", gateway.lastCall);
        assertTrue(gateway.lastBookData.authors().isEmpty());
        assertTrue(gateway.lastBookData.categoryIds().isEmpty());

        gateway.failure = databaseFailure("P2033");
        mvc.perform(post("/api/v1/admin/books").header("Authorization", adminToken("17"))
                        .contentType(MediaType.APPLICATION_JSON).content(empty))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("P2033"))
                .andExpect(jsonPath("$.detail").value("El libro debe tener al menos una categoría."));

        String repeatedOrder = "{\"title\":\"1984\",\"subtitle\":null,\"synopsis\":null,"
                + "\"authors\":[{\"authorId\":\"15\",\"order\":1},{\"authorId\":\"16\",\"order\":1}],"
                + "\"categoryIds\":[\"2\"]}";
        gateway.failure = databaseFailure("P2034");
        mvc.perform(post("/api/v1/admin/books").header("Authorization", adminToken("17"))
                        .contentType(MediaType.APPLICATION_JSON).content(repeatedOrder))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("P2034"))
                .andExpect(jsonPath("$.detail").value("El orden de los autores no es válido."));
        assertEquals(List.of(new BookAuthorInput(15, 1), new BookAuthorInput(16, 1)), gateway.lastBookData.authors());
    }

    private void changeStatus(String admin, String resource, long id) throws Exception {
        String response = "{\"state\":\"INACTIVE\"}";
        mvc.perform(put("/api/v1/admin/" + resource + "/" + id + "/status").header("Authorization", admin)
                        .contentType(MediaType.APPLICATION_JSON).content(response))
                .andExpect(status().isNoContent());
        mvc.perform(put("/api/v1/admin/" + resource + "/" + id + "/status").header("Authorization", admin)
                        .contentType(MediaType.APPLICATION_JSON).content(response))
                .andExpect(status().isNoContent());
        assertTrue(gateway.lastCall.endsWith("Status"));
        assertEquals("INACTIVE", gateway.lastState);
    }

    private DatabaseException databaseFailure(String state) {
        return exceptionTranslator.translate(new SQLException("private postgres constraint and SQL text", state));
    }

    private String adminToken(String actor) { return token(actor, "ADMIN"); }
    private String customerToken(String actor) { return token(actor, "CUSTOMER"); }
    private String token(String actor, String role) {
        Instant issued = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.SECONDS);
        return "Bearer " + tokenIssuer.issue(actor, role, issued, issued.plusSeconds(1800), UUID.randomUUID().toString());
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class TestConfigurationForAdminCatalog {
        @Bean PlatformTransactionManager transactionManager() {
            return new PlatformTransactionManager() {
                @Override public TransactionStatus getTransaction(TransactionDefinition definition) { return new SimpleTransactionStatus(); }
                @Override public void commit(TransactionStatus status) { }
                @Override public void rollback(TransactionStatus status) { }
            };
        }
        @Bean @Primary FakeAdminCatalogGateway adminCatalogGateway(DatabaseExceptionTranslator translator) {
            return new FakeAdminCatalogGateway(translator);
        }
    }

    static class FakeAdminCatalogGateway implements AdminCatalogGateway {
        private final DatabaseExceptionTranslator translator;
        private DatabaseException failure;
        private int searchCalls;
        private int mutationCalls;
        private long lastActorId;
        private String lastCall;
        private String lastState;
        private Search lastSearch;
        private EditionSearch lastEditionSearch;
        private AuthorData lastAuthorData;
        private PublisherData lastPublisherData;
        private CategoryData lastCategoryData;
        private BookData lastBookData;
        private EditionCreateData lastEditionCreate;
        private EditionUpdateData lastEditionUpdate;
        private Page<EditionRow> editionPage = new Page<>(List.of(), 0);
        private Page<BookRow> bookPage = new Page<>(List.of(), 0);

        FakeAdminCatalogGateway(DatabaseExceptionTranslator translator) { this.translator = translator; }
        void reset() {
            failure = null; searchCalls = 0; mutationCalls = 0; lastActorId = 0; lastCall = null; lastState = null;
            lastSearch = null; lastEditionSearch = null; lastAuthorData = null; lastPublisherData = null;
            lastCategoryData = null; lastBookData = null; lastEditionCreate = null; lastEditionUpdate = null;
            editionPage = new Page<>(List.of(), 0); bookPage = new Page<>(List.of(), 0);
        }
        private void search(long actorId, Search query, String name) { lastActorId = actorId; lastSearch = query; lastCall = name; searchCalls++; maybeFail(); }
        private void mutation(long actorId, String name) { lastActorId = actorId; lastCall = name; mutationCalls++; maybeFail(); }
        private void status(long actorId, String name, String state) { mutation(actorId, name); lastState = state; }
        private void maybeFail() { if (failure != null) throw failure; }
        @Override public Page<AuthorRow> searchAuthors(long actor, Search query) { search(actor, query, "searchAuthors"); return new Page<>(List.of(), 0); }
        @Override public Page<PublisherRow> searchPublishers(long actor, Search query) { search(actor, query, "searchPublishers"); return new Page<>(List.of(), 0); }
        @Override public Page<CategoryRow> searchCategories(long actor, Search query) { search(actor, query, "searchCategories"); return new Page<>(List.of(), 0); }
        @Override public Page<BookRow> searchBooks(long actor, Search query) { search(actor, query, "searchBooks"); return bookPage; }
        @Override public Page<EditionRow> searchEditions(long actor, EditionSearch query) {
            maybeFail(); lastActorId = actor; lastEditionSearch = query; lastCall = "searchEditions"; searchCalls++; return editionPage;
        }
        @Override public long createAuthor(long actor, AuthorData data) { mutation(actor, "createAuthor"); lastAuthorData = data; return 501; }
        @Override public void updateAuthor(long actor, long id, AuthorData data) { mutation(actor, "updateAuthor"); lastAuthorData = data; }
        @Override public void setAuthorStatus(long actor, long id, String state) { status(actor, "setAuthorStatus", state); }
        @Override public long createPublisher(long actor, PublisherData data) { mutation(actor, "createPublisher"); lastPublisherData = data; return 502; }
        @Override public void updatePublisher(long actor, long id, PublisherData data) { mutation(actor, "updatePublisher"); lastPublisherData = data; }
        @Override public void setPublisherStatus(long actor, long id, String state) { status(actor, "setPublisherStatus", state); }
        @Override public long createCategory(long actor, CategoryData data) { mutation(actor, "createCategory"); lastCategoryData = data; return 503; }
        @Override public void updateCategory(long actor, long id, CategoryData data) { mutation(actor, "updateCategory"); lastCategoryData = data; }
        @Override public void setCategoryStatus(long actor, long id, String state) { status(actor, "setCategoryStatus", state); }
        @Override public long createBook(long actor, BookData data) { lastBookData = data; mutation(actor, "createBook"); return 504; }
        @Override public void updateBook(long actor, long id, BookData data) { lastBookData = data; mutation(actor, "updateBook"); }
        @Override public void setBookStatus(long actor, long id, String state) { status(actor, "setBookStatus", state); }
        @Override public long createEdition(long actor, EditionCreateData data) { mutation(actor, "createEdition"); lastEditionCreate = data; return 505; }
        @Override public void updateEdition(long actor, long id, EditionUpdateData data) { mutation(actor, "updateEdition"); lastEditionUpdate = data; }
        @Override public void setEditionStatus(long actor, long id, String state) { status(actor, "setEditionStatus", state); }
    }
}
