package com.pliego.modules.catalog.gateway;

import java.math.BigDecimal;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Types;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import com.pliego.foundation.database.DatabaseExceptionTranslator;
import com.pliego.foundation.database.JdbcGatewaySupport;
import com.pliego.modules.catalog.application.CatalogEditionDetail;
import com.pliego.modules.catalog.application.CatalogEditionDetail.Author;
import com.pliego.modules.catalog.application.CatalogEditionDetail.Category;
import com.pliego.modules.catalog.application.CatalogEditionDetail.Publisher;
import com.pliego.modules.catalog.application.CatalogEditionSummary;
import com.pliego.modules.catalog.application.CatalogQuery;
import com.pliego.modules.catalog.application.CatalogSearchPage;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** Reads public catalog data only through the approved PostgreSQL Functions. */
@Repository
public class JdbcCatalogGateway extends JdbcGatewaySupport implements CatalogGateway {

    private static final String CATALOG_SEARCH_QUERY = "SELECT edition_id, book_id, title, authors_ordered, "
            + "publisher_name, btrim(isbn13::text) AS isbn13, price, cover_url, cover_license, cover_attribution, "
            + "format, language, available, total_count FROM pliego.fn_catalog_search(?,?,?,?,?,?,?,?,?,?,?)";
    private static final String EDITION_DETAIL_QUERY = "SELECT edition_id, book_id, title, subtitle, synopsis, "
            + "authors_json::text AS authors_json, categories_json::text AS categories_json, publisher_id, "
            + "publisher_name, btrim(isbn13::text) AS isbn13, sku, language, format, page_count, publication_date, "
            + "price, cover_url, cover_license, cover_source_url, cover_attribution, available "
            + "FROM pliego.fn_edition_detail(?)";

    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;

    public JdbcCatalogGateway(DatabaseExceptionTranslator exceptionTranslator, JdbcTemplate jdbcTemplate,
            ObjectMapper objectMapper) {
        super(exceptionTranslator);
        this.jdbcTemplate = jdbcTemplate;
        this.objectMapper = objectMapper;
    }

    @Override
    public CatalogSearchPage search(CatalogQuery query) {
        return withDatabaseErrorTranslation(() -> {
            List<CatalogSearchRow> rows = runCatalogSearch(query, query.page());
            long totalCount;
            if (!rows.isEmpty()) {
                totalCount = rows.getFirst().totalCount();
            } else if (query.page() > 0) {
                // The approved Function places total_count on each item row, so read page zero
                // only when the requested page is empty to preserve a useful count.
                List<CatalogSearchRow> firstPage = runCatalogSearch(query, 0);
                totalCount = firstPage.isEmpty() ? 0 : firstPage.getFirst().totalCount();
            } else {
                totalCount = 0;
            }
            return new CatalogSearchPage(rows.stream().map(CatalogSearchRow::edition).toList(), totalCount);
        });
    }

    @Override
    public Optional<CatalogEditionDetail> findPublicEdition(long editionId) {
        return withDatabaseErrorTranslation(() -> jdbcTemplate.query(EDITION_DETAIL_QUERY,
                statement -> statement.setLong(1, editionId), editionDetailRowMapper()).stream().findFirst());
    }

    private List<CatalogSearchRow> runCatalogSearch(CatalogQuery query, int page) {
        return jdbcTemplate.query(CATALOG_SEARCH_QUERY, statement -> bindSearch(statement, query, page),
                catalogSearchRowMapper());
    }

    private static void bindSearch(PreparedStatement statement, CatalogQuery query, int page) throws SQLException {
        setNullableString(statement, 1, query.title());
        setNullableString(statement, 2, query.author());
        setNullableString(statement, 3, query.isbn13());
        setNullableString(statement, 4, query.category());
        setNullableDecimal(statement, 5, query.minPrice());
        setNullableDecimal(statement, 6, query.maxPrice());
        setNullableString(statement, 7, query.language());
        setNullableString(statement, 8, query.format());
        statement.setString(9, query.sort());
        statement.setInt(10, page);
        statement.setInt(11, query.pageSize());
    }

    private RowMapper<CatalogSearchRow> catalogSearchRowMapper() {
        return (results, rowNumber) -> new CatalogSearchRow(
                new CatalogEditionSummary(Long.toString(results.getLong("edition_id")),
                        Long.toString(results.getLong("book_id")), results.getString("title"),
                        results.getString("authors_ordered"), results.getString("publisher_name"),
                        results.getString("isbn13"), results.getBigDecimal("price"),
                        results.getString("cover_url"), results.getString("cover_license"),
                        results.getString("cover_attribution"), results.getString("format"),
                        results.getString("language"), results.getBoolean("available")),
                results.getLong("total_count"));
    }

    private RowMapper<CatalogEditionDetail> editionDetailRowMapper() {
        return (results, rowNumber) -> new CatalogEditionDetail(
                Long.toString(results.getLong("edition_id")), Long.toString(results.getLong("book_id")),
                results.getString("title"), results.getString("subtitle"), results.getString("synopsis"),
                parseAuthors(results.getString("authors_json")), parseCategories(results.getString("categories_json")),
                new Publisher(Long.toString(results.getLong("publisher_id")), results.getString("publisher_name")),
                results.getString("isbn13"), results.getString("sku"), results.getString("language"),
                results.getString("format"), results.getObject("page_count", Integer.class),
                results.getObject("publication_date", LocalDate.class), results.getBigDecimal("price"),
                results.getString("cover_url"), results.getString("cover_license"),
                results.getString("cover_source_url"), results.getString("cover_attribution"),
                results.getBoolean("available"));
    }

    private List<Author> parseAuthors(String json) throws SQLException {
        JsonNode authors = parseJsonArray(json, "authors_json");
        return java.util.stream.StreamSupport.stream(authors.spliterator(), false)
                .map(author -> new Author(author.path("authorId").asText(), author.path("name").asText(),
                        author.path("order").asInt()))
                .toList();
    }

    private List<Category> parseCategories(String json) throws SQLException {
        JsonNode categories = parseJsonArray(json, "categories_json");
        return java.util.stream.StreamSupport.stream(categories.spliterator(), false)
                .map(category -> {
                    JsonNode parentId = category.get("parentCategoryId");
                    return new Category(category.path("categoryId").asText(), category.path("name").asText(),
                            category.path("slug").asText(), parentId == null || parentId.isNull()
                                    ? null : parentId.asText());
                })
                .toList();
    }

    private JsonNode parseJsonArray(String json, String column) throws SQLException {
        try {
            JsonNode value = objectMapper.readTree(json);
            if (value == null || !value.isArray()) {
                throw invalidFunctionJson(column, null);
            }
            return value;
        } catch (JacksonException exception) {
            throw invalidFunctionJson(column, exception);
        }
    }

    private static SQLException invalidFunctionJson(String column, Throwable cause) {
        return new SQLException("Approved catalog Function returned invalid " + column, "23514", cause);
    }

    private static void setNullableString(PreparedStatement statement, int index, String value) throws SQLException {
        if (value == null) statement.setNull(index, Types.VARCHAR);
        else statement.setString(index, value);
    }

    private static void setNullableDecimal(PreparedStatement statement, int index, BigDecimal value)
            throws SQLException {
        if (value == null) statement.setNull(index, Types.NUMERIC);
        else statement.setBigDecimal(index, value);
    }

    private record CatalogSearchRow(CatalogEditionSummary edition, long totalCount) {
    }
}
