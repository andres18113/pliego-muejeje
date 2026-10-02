package com.pliego.modules.catalog.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.math.BigDecimal;
import java.sql.SQLException;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
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
import com.pliego.modules.catalog.application.CatalogEditionDetail;
import com.pliego.modules.catalog.application.CatalogEditionDetail.Author;
import com.pliego.modules.catalog.application.CatalogEditionDetail.Category;
import com.pliego.modules.catalog.application.CatalogEditionDetail.Publisher;
import com.pliego.modules.catalog.application.CatalogEditionSummary;
import com.pliego.modules.catalog.application.CatalogQuery;
import com.pliego.modules.catalog.application.CatalogSearchPage;
import com.pliego.modules.catalog.application.PublicCatalogCategory;
import com.pliego.modules.catalog.application.PublicCatalogFilterOptions;
import com.pliego.modules.catalog.gateway.CatalogGateway;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

@SpringBootTest(properties = {
        "spring.datasource.url=jdbc:postgresql://localhost:5432/pliego_i4_test",
        "spring.datasource.username=pliego_test",
        "spring.datasource.password=pliego_test",
        "spring.flyway.enabled=false",
        "PLIEGO_ADMIN_EMAIL=admin@example.com",
        "PLIEGO_ADMIN_PASSWORD_HASH=unused",
        "PLIEGO_JWT_SECRET=0123456789abcdef0123456789abcdef",
        "pliego.cors.allowed-origins="
})
@AutoConfigureMockMvc
@Import(CatalogApiIntegrationTest.CatalogTestConfiguration.class)
class CatalogApiIntegrationTest {

    private static final String CDN_COVER_URL =
            "https://covers.pliegolibros.com/covers/editions/v2/PLG-BK-000001-52ead14866be.webp";

    private static final CatalogEditionSummary SUMMARY = new CatalogEditionSummary("250", "80",
            "Don Quijote de la Mancha", "Miguel de Cervantes", "Editorial Ejemplo", "9780306406157",
            new BigDecimal("18.50"), CDN_COVER_URL, null, null,
            "PAPERBACK", "es", true);

    private static final CatalogEditionDetail DETAIL = new CatalogEditionDetail("250", "80",
            "Don Quijote de la Mancha", null,
            "Una novela clásica.",
            List.of(new Author("12", "Miguel de Cervantes", 1)),
            List.of(new Category("2", "Literatura", "literatura", null)),
            new Publisher("7", "Editorial Ejemplo"), "9780306406157", "PLG-LIT-001", "es",
            "PAPERBACK", 560, LocalDate.of(2024, 1, 1), new BigDecimal("18.50"),
            CDN_COVER_URL, null, null,
            null, true);

    @Autowired
    MockMvc mvc;

    @Autowired
    ObjectMapper objectMapper;

    @Autowired
    FakeCatalogGateway gateway;

    @BeforeEach
    void resetGateway() {
        gateway.reset();
    }

    @Test
    void publicSearchUsesDefaultsAndSerializesContractValues() throws Exception {
        String response = mvc.perform(get("/api/v1/catalog/editions"))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.page").value(0))
                .andExpect(jsonPath("$.pageSize").value(20))
                .andExpect(jsonPath("$.totalCount").value("1"))
                .andExpect(jsonPath("$.items[0].editionId").value("250"))
                .andExpect(jsonPath("$.items[0].bookId").value("80"))
                .andExpect(jsonPath("$.items[0].price").value("18.50"))
                .andExpect(jsonPath("$.items[0].coverUrl").value(CDN_COVER_URL))
                .andExpect(jsonPath("$.items[0].coverLicense").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.items[0].available").value(true))
                .andReturn().getResponse().getContentAsString();

        assertEquals(new CatalogQuery(null, null, null, null, null, null, null, null, null,
                "TITLE_ASC", 0, 20), gateway.lastQuery);
        assertFalse(response.contains("stock"));
        assertFalse(response.contains("stockActual"));
    }

    @Test
    void allApprovedFiltersAndExplicitPaginationReachTheGateway() throws Exception {
        mvc.perform(get("/api/v1/catalog/editions")
                        .param("title", "Don Quijote")
                        .param("author", "Cervantes")
                        .param("isbn13", "9780306406157")
                        .param("category", "literatura")
                        .param("minPrice", "10.25")
                        .param("maxPrice", "20.00")
                        .param("language", "es")
                        .param("format", "PAPERBACK")
                        .param("sort", "PRICE_ASC")
                        .param("page", "1")
                        .param("pageSize", "5"))
                .andExpect(status().isOk());

        assertEquals("Don Quijote", gateway.lastQuery.title());
        assertEquals("Cervantes", gateway.lastQuery.author());
        assertEquals("9780306406157", gateway.lastQuery.isbn13());
        assertEquals("literatura", gateway.lastQuery.category());
        assertEquals(0, new BigDecimal("10.25").compareTo(gateway.lastQuery.minPrice()));
        assertEquals(0, new BigDecimal("20.00").compareTo(gateway.lastQuery.maxPrice()));
        assertEquals("es", gateway.lastQuery.language());
        assertEquals("PAPERBACK", gateway.lastQuery.format());
        assertEquals("PRICE_ASC", gateway.lastQuery.sort());
        assertEquals(1, gateway.lastQuery.page());
        assertEquals(5, gateway.lastQuery.pageSize());
    }

    @Test
    void globalQueryAndFiltersReachTheGateway() throws Exception {
        mvc.perform(get("/api/v1/catalog/editions")
                        .param("que", "Gabriel García Márquez")
                        .param("category", "literatura")
                        .param("page", "1"))
                .andExpect(status().isOk());

        assertEquals("Gabriel García Márquez", gateway.lastQuery.query());
        assertEquals("literatura", gateway.lastQuery.category());
        assertEquals(1, gateway.lastQuery.page());
    }

    @ParameterizedTest
    @ValueSource(strings = {"TITLE_ASC", "PRICE_ASC", "PRICE_DESC"})
    void supportsEachApprovedSortMode(String sort) throws Exception {
        mvc.perform(get("/api/v1/catalog/editions").param("sort", sort))
                .andExpect(status().isOk());

        assertEquals(sort, gateway.lastQuery.sort());
    }

    @Test
    void rootCategoryIsPassedToTheApprovedSearchFunction() throws Exception {
        gateway.searchPage = new CatalogSearchPage(List.of(SUMMARY), 1);

        mvc.perform(get("/api/v1/catalog/editions").param("category", "literatura"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].editionId").value("250"));

        assertEquals("literatura", gateway.lastQuery.category());
    }

    @Test
    void validUnknownCategoryReturnsAnEmptyPage() throws Exception {
        gateway.searchPage = new CatalogSearchPage(List.of(), 0);

        mvc.perform(get("/api/v1/catalog/editions").param("category", "categoria-inexistente"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items").isEmpty())
                .andExpect(jsonPath("$.totalCount").value("0"));

        assertEquals("categoria-inexistente", gateway.lastQuery.category());
    }

    @Test
    void inactiveCategoryReturnsTheExistingCategoryConflictProblem() throws Exception {
        gateway.failure = gateway.translator.translate(new SQLException("private inactive category", "P2022"));

        mvc.perform(get("/api/v1/catalog/editions").param("category", "literatura"))
                .andExpect(status().isConflict())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("P2022"))
                .andExpect(jsonPath("$.title").value("Categoría no disponible"))
                .andExpect(jsonPath("$.detail").value("La categoría no está disponible para esta operación."));
    }

    @Test
    void publicCategoryListIncludesOnlyContractFieldsAndHierarchy() throws Exception {
        gateway.publicCategories = List.of(new PublicCatalogCategory("literatura", "Literatura", null),
                new PublicCatalogCategory("novela", "Novela", "literatura"));

        mvc.perform(get("/api/v1/catalog/categories"))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.items[0].slug").value("literatura"))
                .andExpect(jsonPath("$.items[0].name").value("Literatura"))
                .andExpect(jsonPath("$.items[0].parentSlug").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.items[1].slug").value("novela"))
                .andExpect(jsonPath("$.items[1].parentSlug").value("literatura"))
                .andExpect(jsonPath("$.items[0].categoryId").doesNotExist())
                .andExpect(jsonPath("$.items[0].state").doesNotExist());
    }

    @Test
    void publicFilterOptionsReturnDatabaseLanguagesAndMoneyAsStrings() throws Exception {
        gateway.publicFilterOptions = new PublicCatalogFilterOptions(List.of("en", "es"), List.of("HARDCOVER", "PAPERBACK"),
                new BigDecimal("7.25"), new BigDecimal("38.00"));

        mvc.perform(get("/api/v1/catalog/filter-options"))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.languages[0]").value("en"))
                .andExpect(jsonPath("$.languages[1]").value("es"))
                .andExpect(jsonPath("$.formats[0]").value("HARDCOVER"))
                .andExpect(jsonPath("$.formats[1]").value("PAPERBACK"))
                .andExpect(jsonPath("$.minimumPrice").value("7.25"))
                .andExpect(jsonPath("$.maximumPrice").value("38.00"));
    }

    @Test
    void generatedOpenApiIncludesPublicCategoryDiscoveryAndFilterConflict() throws Exception {
        mvc.perform(get("/v3/api-docs"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.paths['/api/v1/catalog/categories'].get.summary")
                        .value("Listar categorías del catálogo público"))
                .andExpect(jsonPath("$.paths['/api/v1/catalog/filter-options'].get.summary")
                        .value("Consultar opciones de filtros del catálogo público"))
                .andExpect(jsonPath("$.paths['/api/v1/catalog/editions'].get.responses['200'].content['application/json'].schema.$ref")
                        .value("#/components/schemas/CatalogEditionSearchResponse"))
                .andExpect(jsonPath("$.paths['/api/v1/catalog/editions'].get.responses['409']")
                        .exists());
    }

    @Test
    void invalidSortAndFiltersReturnSpanishValidationProblems() throws Exception {
        assertInvalidFilter("sort", "RECENT");
        assertInvalidFilter("isbn13", "978030640615X");
        assertInvalidFilter("category", "una/categoria");
        assertInvalidFilter("language", "spanish");
        assertInvalidFilter("format", "AUDIOBOOK");
        assertInvalidFilter("minPrice", "-1.00");
    }

    @Test
    void invalidDatabasePriceRangeUsesSpanishProblemDetail() throws Exception {
        gateway.failure = gateway.translator.translate(new SQLException("private invalid price range", "P1001"));

        mvc.perform(get("/api/v1/catalog/editions").param("minPrice", "20.00").param("maxPrice", "10.00"))
                .andExpect(status().isBadRequest())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("P1001"))
                .andExpect(jsonPath("$.title").value("Datos inválidos"))
                .andExpect(jsonPath("$.detail").value("Revisa los filtros enviados e intenta nuevamente."));
    }

    @Test
    void invalidPageAndPageSizeReturnSpanishValidationProblems() throws Exception {
        assertInvalidFilter("page", "-1");
        assertInvalidFilter("pageSize", "0");
        assertInvalidFilter("pageSize", "51");
    }

    @Test
    void detailReturnsOrderedMetadataWithStringIdsMoneyAndDate() throws Exception {
        gateway.publicEdition = Optional.of(DETAIL);

        String response = mvc.perform(get("/api/v1/catalog/editions/250"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.editionId").value("250"))
                .andExpect(jsonPath("$.bookId").value("80"))
                .andExpect(jsonPath("$.title").value("Don Quijote de la Mancha"))
                .andExpect(jsonPath("$.subtitle").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.synopsis").value("Una novela clásica."))
                .andExpect(jsonPath("$.authors[0].authorId").value("12"))
                .andExpect(jsonPath("$.authors[0].order").value(1))
                .andExpect(jsonPath("$.categories[0].categoryId").value("2"))
                .andExpect(jsonPath("$.categories[0].parentCategoryId").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.publisher.publisherId").value("7"))
                .andExpect(jsonPath("$.isbn13").value("9780306406157"))
                .andExpect(jsonPath("$.sku").value("PLG-LIT-001"))
                .andExpect(jsonPath("$.pageCount").value(560))
                .andExpect(jsonPath("$.publicationDate").value("2024-01-01"))
                .andExpect(jsonPath("$.price").value("18.50"))
                .andExpect(jsonPath("$.coverUrl").value(CDN_COVER_URL))
                .andExpect(jsonPath("$.coverLicense").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.coverSourceUrl").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.available").value(true))
                .andReturn().getResponse().getContentAsString();

        JsonNode json = objectMapper.readTree(response);
        assertTrue(json.get("editionId").isTextual());
        assertTrue(json.get("bookId").isTextual());
        assertTrue(json.get("price").isTextual());
        assertFalse(response.contains("stock"));
        assertEquals(250, gateway.lastEditionId);
    }

    @Test
    void nonexistentAndNonpublicEditionsHaveTheSameSafeNotFoundResponse() throws Exception {
        String nonexistent = mvc.perform(get("/api/v1/catalog/editions/999"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("P2041"))
                .andExpect(jsonPath("$.title").value("Edición no encontrada"))
                .andExpect(jsonPath("$.detail").value("La edición solicitada no está disponible."))
                .andReturn().getResponse().getContentAsString();
        gateway.publicEdition = Optional.empty(); // The Function returns no row for inactive/nonpublic records too.
        String nonpublic = mvc.perform(get("/api/v1/catalog/editions/998"))
                .andExpect(status().isNotFound())
                .andReturn().getResponse().getContentAsString();

        ObjectNode expected = (ObjectNode) objectMapper.readTree(nonexistent);
        ObjectNode actual = (ObjectNode) objectMapper.readTree(nonpublic);
        expected.remove(List.of("instance", "traceId"));
        actual.remove(List.of("instance", "traceId"));
        assertEquals(expected, actual);
        assertNull(gateway.publicEdition.orElse(null));
    }

    private void assertInvalidFilter(String name, String value) throws Exception {
        mvc.perform(get("/api/v1/catalog/editions").param(name, value))
                .andExpect(status().isBadRequest())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.title").value("Datos inválidos"))
                .andExpect(jsonPath("$.detail").value("Revisa los filtros enviados e intenta nuevamente."));
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class CatalogTestConfiguration {

        @Bean
        PlatformTransactionManager transactionManager() {
            return new PlatformTransactionManager() {
                @Override public TransactionStatus getTransaction(TransactionDefinition definition) {
                    return new SimpleTransactionStatus();
                }
                @Override public void commit(TransactionStatus status) { }
                @Override public void rollback(TransactionStatus status) { }
            };
        }

        @Bean
        @Primary
        FakeCatalogGateway catalogGateway(DatabaseExceptionTranslator translator) {
            return new FakeCatalogGateway(translator);
        }

    }

    static class FakeCatalogGateway implements CatalogGateway {
        private final DatabaseExceptionTranslator translator;
        private CatalogQuery lastQuery;
        private long lastEditionId;
        private CatalogSearchPage searchPage = new CatalogSearchPage(List.of(SUMMARY), 1);
        private List<PublicCatalogCategory> publicCategories = List.of();
        private PublicCatalogFilterOptions publicFilterOptions = new PublicCatalogFilterOptions(List.of(), List.of(), null, null);
        private Optional<CatalogEditionDetail> publicEdition = Optional.empty();
        private DatabaseException failure;

        FakeCatalogGateway(DatabaseExceptionTranslator translator) {
            this.translator = translator;
        }

        void reset() {
            lastQuery = null;
            lastEditionId = 0;
            searchPage = new CatalogSearchPage(List.of(SUMMARY), 1);
            publicCategories = List.of();
            publicFilterOptions = new PublicCatalogFilterOptions(List.of(), List.of(), null, null);
            publicEdition = Optional.empty();
            failure = null;
        }

        @Override
        public CatalogSearchPage search(CatalogQuery query) {
            lastQuery = query;
            if (failure != null) throw failure;
            return searchPage;
        }

        @Override
        public List<PublicCatalogCategory> findPublicCategories() {
            if (failure != null) throw failure;
            return publicCategories;
        }

        @Override
        public PublicCatalogFilterOptions findPublicFilterOptions() {
            if (failure != null) throw failure;
            return publicFilterOptions;
        }

        @Override
        public Optional<CatalogEditionDetail> findPublicEdition(long editionId) {
            lastEditionId = editionId;
            if (failure != null) throw failure;
            return publicEdition;
        }
    }
}
