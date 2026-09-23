package com.pliego.modules.catalog.gateway;

import java.sql.Date;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Types;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;

import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import com.pliego.foundation.database.DatabaseExceptionTranslator;
import com.pliego.foundation.database.JdbcGatewaySupport;
import static com.pliego.modules.catalog.application.AdminCatalogModels.*;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** Executes approved ADMIN catalog Functions and Procedures; it contains no business-table SQL. */
@Repository
public class JdbcAdminCatalogGateway extends JdbcGatewaySupport implements AdminCatalogGateway {

    private static final String AUTHOR_SEARCH = "SELECT author_id,name,biography,state,created_at,updated_at,total_count FROM pliego.fn_admin_author_search(?,?,?,?,?)";
    private static final String PUBLISHER_SEARCH = "SELECT publisher_id,name,description,state,created_at,updated_at,total_count FROM pliego.fn_admin_publisher_search(?,?,?,?,?)";
    private static final String CATEGORY_SEARCH = "SELECT category_id,parent_category_id,parent_name,name,slug,description,state,created_at,updated_at,total_count FROM pliego.fn_admin_category_search(?,?,?,?,?)";
    private static final String BOOK_SEARCH = "SELECT book_id,title,subtitle,synopsis,state,authors_json::text AS authors_json,categories_json::text AS categories_json,created_at,updated_at,total_count FROM pliego.fn_admin_book_search(?,?,?,?,?)";
    private static final String EDITION_SEARCH = "SELECT edition_id,book_id,book_title,publisher_id,publisher_name,sku,btrim(isbn13::text) AS isbn13,language,format,page_count,publication_date,price,cover_url,cover_license,cover_source_url,cover_attribution,state,stock_actual,created_at,updated_at,total_count FROM pliego.fn_admin_edition_search(?,?,?,?,?,?)";

    private static final String AUTHOR_CREATE = "CALL pliego.sp_author_create(?,?,?,?)";
    private static final String AUTHOR_UPDATE = "CALL pliego.sp_author_update(?,?,?,?)";
    private static final String AUTHOR_STATUS = "CALL pliego.sp_author_set_status(?,?,?)";
    private static final String PUBLISHER_CREATE = "CALL pliego.sp_publisher_create(?,?,?,?)";
    private static final String PUBLISHER_UPDATE = "CALL pliego.sp_publisher_update(?,?,?,?)";
    private static final String PUBLISHER_STATUS = "CALL pliego.sp_publisher_set_status(?,?,?)";
    private static final String CATEGORY_CREATE = "CALL pliego.sp_category_create(?,?,?,?,?,?)";
    private static final String CATEGORY_UPDATE = "CALL pliego.sp_category_update(?,?,?,?,?,?)";
    private static final String CATEGORY_STATUS = "CALL pliego.sp_category_set_status(?,?,?)";
    private static final String BOOK_CREATE = "CALL pliego.sp_book_create(?,?,?,?,?,?,?)";
    private static final String BOOK_UPDATE = "CALL pliego.sp_book_update(?,?,?,?,?,?,?)";
    private static final String BOOK_STATUS = "CALL pliego.sp_book_set_status(?,?,?)";
    private static final String EDITION_CREATE = "CALL pliego.sp_edition_create(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)";
    private static final String EDITION_UPDATE = "CALL pliego.sp_edition_update(?,?,?,?,?,?,?,?,?,?,?,?,?)";
    private static final String EDITION_STATUS = "CALL pliego.sp_edition_set_status(?,?,?)";

    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;

    public JdbcAdminCatalogGateway(DatabaseExceptionTranslator exceptionTranslator, JdbcTemplate jdbcTemplate,
            ObjectMapper objectMapper) {
        super(exceptionTranslator);
        this.jdbcTemplate = jdbcTemplate;
        this.objectMapper = objectMapper;
    }

    @Override
    public Page<AuthorRow> searchAuthors(long actorId, Search query) {
        return queryPage(AUTHOR_SEARCH, actorId, query, (rs, row) -> new Counted<>(new AuthorRow(
                id(rs, "author_id"), rs.getString("name"), rs.getString("biography"), rs.getString("state"),
                timestamp(rs, "created_at"), timestamp(rs, "updated_at")), rs.getLong("total_count")));
    }

    @Override
    public Page<PublisherRow> searchPublishers(long actorId, Search query) {
        return queryPage(PUBLISHER_SEARCH, actorId, query, (rs, row) -> new Counted<>(new PublisherRow(
                id(rs, "publisher_id"), rs.getString("name"), rs.getString("description"), rs.getString("state"),
                timestamp(rs, "created_at"), timestamp(rs, "updated_at")), rs.getLong("total_count")));
    }

    @Override
    public Page<CategoryRow> searchCategories(long actorId, Search query) {
        return queryPage(CATEGORY_SEARCH, actorId, query, (rs, row) -> new Counted<>(new CategoryRow(
                id(rs, "category_id"), nullableId(rs, "parent_category_id"), rs.getString("parent_name"),
                rs.getString("name"), rs.getString("slug"), rs.getString("description"), rs.getString("state"),
                timestamp(rs, "created_at"), timestamp(rs, "updated_at")), rs.getLong("total_count")));
    }

    @Override
    public Page<BookRow> searchBooks(long actorId, Search query) {
        return queryPage(BOOK_SEARCH, actorId, query, (rs, row) -> new Counted<>(new BookRow(
                id(rs, "book_id"), rs.getString("title"), rs.getString("subtitle"), rs.getString("synopsis"),
                rs.getString("state"), parseAuthors(rs.getString("authors_json")),
                parseCategories(rs.getString("categories_json")), timestamp(rs, "created_at"),
                timestamp(rs, "updated_at")), rs.getLong("total_count")));
    }

    @Override
    public Page<EditionRow> searchEditions(long actorId, EditionSearch query) {
        return withDatabaseErrorTranslation(() -> {
            List<Counted<EditionRow>> rows = runEditionSearch(actorId, query, query.page());
            long total = rows.isEmpty() && query.page() > 0
                    ? firstCount(runEditionSearch(actorId, query, 0)) : firstCount(rows);
            return new Page<>(rows.stream().map(Counted::value).toList(), total);
        });
    }

    @Override public long createAuthor(long actorId, AuthorData data) {
        return create(AUTHOR_CREATE, 4, "o_author_id", statement -> {
            statement.setLong(1, actorId); statement.setString(2, data.name()); nullableString(statement, 3, data.biography());
        });
    }
    @Override public void updateAuthor(long actorId, long authorId, AuthorData data) {
        execute(AUTHOR_UPDATE, statement -> { statement.setLong(1, actorId); statement.setLong(2, authorId);
            statement.setString(3, data.name()); nullableString(statement, 4, data.biography()); });
    }
    @Override public void setAuthorStatus(long actorId, long authorId, String state) {
        setStatus(AUTHOR_STATUS, actorId, authorId, state);
    }

    @Override public long createPublisher(long actorId, PublisherData data) {
        return create(PUBLISHER_CREATE, 4, "o_publisher_id", statement -> {
            statement.setLong(1, actorId); statement.setString(2, data.name()); nullableString(statement, 3, data.description());
        });
    }
    @Override public void updatePublisher(long actorId, long publisherId, PublisherData data) {
        execute(PUBLISHER_UPDATE, statement -> { statement.setLong(1, actorId); statement.setLong(2, publisherId);
            statement.setString(3, data.name()); nullableString(statement, 4, data.description()); });
    }
    @Override public void setPublisherStatus(long actorId, long publisherId, String state) {
        setStatus(PUBLISHER_STATUS, actorId, publisherId, state);
    }

    @Override public long createCategory(long actorId, CategoryData data) {
        return create(CATEGORY_CREATE, 6, "o_category_id", statement -> bindCategory(statement, actorId, null, data, true));
    }
    @Override public void updateCategory(long actorId, long categoryId, CategoryData data) {
        execute(CATEGORY_UPDATE, statement -> bindCategory(statement, actorId, categoryId, data, false));
    }
    @Override public void setCategoryStatus(long actorId, long categoryId, String state) {
        setStatus(CATEGORY_STATUS, actorId, categoryId, state);
    }

    @Override public long createBook(long actorId, BookData data) {
        return create(BOOK_CREATE, 7, "o_book_id", statement -> bindBook(statement, actorId, null, data, true));
    }
    @Override public void updateBook(long actorId, long bookId, BookData data) {
        execute(BOOK_UPDATE, statement -> bindBook(statement, actorId, bookId, data, false));
    }
    @Override public void setBookStatus(long actorId, long bookId, String state) {
        setStatus(BOOK_STATUS, actorId, bookId, state);
    }

    @Override public long createEdition(long actorId, EditionCreateData data) {
        return create(EDITION_CREATE, 15, "o_edition_id", statement -> {
            statement.setLong(1, actorId); statement.setLong(2, data.bookId()); statement.setLong(3, data.publisherId());
            statement.setString(4, data.sku()); bindEditionMutable(statement, 5, data.isbn13(), data.language(),
                    data.format(), data.pageCount(), data.publicationDate(), data.price(), data.coverUrl(),
                    data.coverLicense(), data.coverSourceUrl(), data.coverAttribution());
        });
    }
    @Override public void updateEdition(long actorId, long editionId, EditionUpdateData data) {
        execute(EDITION_UPDATE, statement -> {
            statement.setLong(1, actorId); statement.setLong(2, editionId); statement.setLong(3, data.publisherId());
            bindEditionMutable(statement, 4, data.isbn13(), data.language(), data.format(), data.pageCount(),
                    data.publicationDate(), data.price(), data.coverUrl(), data.coverLicense(),
                    data.coverSourceUrl(), data.coverAttribution());
        });
    }
    @Override public void setEditionStatus(long actorId, long editionId, String state) {
        setStatus(EDITION_STATUS, actorId, editionId, state);
    }

    private <T> Page<T> queryPage(String function, long actorId, Search query, RowMapper<Counted<T>> mapper) {
        return withDatabaseErrorTranslation(() -> {
            List<Counted<T>> rows = runSearch(function, actorId, query, query.page(), mapper);
            long total = rows.isEmpty() && query.page() > 0
                    ? firstCount(runSearch(function, actorId, query, 0, mapper)) : firstCount(rows);
            return new Page<>(rows.stream().map(Counted::value).toList(), total);
        });
    }

    private <T> List<Counted<T>> runSearch(String function, long actorId, Search query, int page,
            RowMapper<Counted<T>> mapper) {
        return jdbcTemplate.query(function, statement -> {
            statement.setLong(1, actorId); nullableString(statement, 2, query.query());
            nullableString(statement, 3, query.state()); statement.setInt(4, page); statement.setInt(5, query.pageSize());
        }, mapper);
    }

    private List<Counted<EditionRow>> runEditionSearch(long actorId, EditionSearch query, int page) {
        return jdbcTemplate.query(EDITION_SEARCH, statement -> {
            statement.setLong(1, actorId); nullableString(statement, 2, query.query()); nullableString(statement, 3, query.state());
            nullableLong(statement, 4, query.bookId()); statement.setInt(5, page); statement.setInt(6, query.pageSize());
        }, (rs, row) -> new Counted<>(new EditionRow(id(rs, "edition_id"), id(rs, "book_id"),
                rs.getString("book_title"), id(rs, "publisher_id"), rs.getString("publisher_name"),
                rs.getString("sku"), rs.getString("isbn13"), rs.getString("language"), rs.getString("format"),
                rs.getObject("page_count", Integer.class), rs.getObject("publication_date", LocalDate.class),
                rs.getBigDecimal("price"), rs.getString("cover_url"), rs.getString("cover_license"),
                rs.getString("cover_source_url"), rs.getString("cover_attribution"), rs.getString("state"),
                rs.getInt("stock_actual"), timestamp(rs, "created_at"), timestamp(rs, "updated_at")),
                rs.getLong("total_count")));
    }

    private static long firstCount(List<? extends Counted<?>> rows) {
        return rows.isEmpty() ? 0 : rows.getFirst().totalCount();
    }

    private long create(String call, int outputParameter, String outputColumn, StatementBinder binder) {
        return withDatabaseErrorTranslation(() -> jdbcTemplate.execute((ConnectionCallback<Long>) connection -> {
            try (PreparedStatement statement = connection.prepareStatement(call)) {
                binder.bind(statement);
                statement.setNull(outputParameter, Types.BIGINT);
                try (ResultSet output = statement.executeQuery()) {
                    if (!output.next()) throw new SQLException("Approved create Procedure returned no identifier", "02000");
                    return output.getLong(outputColumn);
                }
            }
        }));
    }

    private void execute(String call, StatementBinder binder) {
        withDatabaseErrorTranslation(() -> jdbcTemplate.execute((ConnectionCallback<Void>) connection -> {
            try (PreparedStatement statement = connection.prepareStatement(call)) {
                binder.bind(statement); statement.execute(); return null;
            }
        }));
    }

    private void setStatus(String call, long actorId, long id, String state) {
        execute(call, statement -> { statement.setLong(1, actorId); statement.setLong(2, id); statement.setString(3, state); });
    }

    private void bindCategory(PreparedStatement statement, long actorId, Long categoryId, CategoryData data,
            boolean create) throws SQLException {
        statement.setLong(1, actorId);
        int offset = 2;
        if (!create) statement.setLong(offset++, categoryId);
        statement.setString(offset++, data.name()); statement.setString(offset++, data.slug());
        nullableString(statement, offset++, data.description()); nullableLong(statement, offset, data.parentCategoryId());
    }

    private void bindBook(PreparedStatement statement, long actorId, Long bookId, BookData data, boolean create)
            throws SQLException {
        statement.setLong(1, actorId); int offset = 2;
        if (!create) statement.setLong(offset++, bookId);
        statement.setString(offset++, data.title()); nullableString(statement, offset++, data.subtitle());
        nullableString(statement, offset++, data.synopsis()); statement.setObject(offset++, writeAuthors(data.authors()), Types.OTHER);
        statement.setObject(offset, writeCategoryIds(data.categoryIds()), Types.OTHER);
    }

    private void bindEditionMutable(PreparedStatement statement, int first, String isbn13, String language,
            String format, int pageCount, LocalDate publicationDate, java.math.BigDecimal price, String coverUrl,
            String coverLicense, String coverSourceUrl, String coverAttribution) throws SQLException {
        nullableString(statement, first, isbn13); statement.setString(first + 1, language);
        statement.setString(first + 2, format); statement.setInt(first + 3, pageCount);
        nullableDate(statement, first + 4, publicationDate); statement.setBigDecimal(first + 5, price);
        nullableString(statement, first + 6, coverUrl); nullableString(statement, first + 7, coverLicense);
        nullableString(statement, first + 8, coverSourceUrl); nullableString(statement, first + 9, coverAttribution);
    }

    private String writeAuthors(List<BookAuthorInput> authors) throws SQLException {
        try {
            return objectMapper.writeValueAsString(authors.stream()
                    .map(author -> new JsonBookAuthor(author.authorId(), author.order())).toList());
        } catch (JacksonException exception) {
            throw new SQLException("Could not encode the approved author input shape", "23514", exception);
        }
    }

    private String writeCategoryIds(List<Long> categoryIds) throws SQLException {
        try { return objectMapper.writeValueAsString(categoryIds); }
        catch (JacksonException exception) {
            throw new SQLException("Could not encode the approved category input shape", "23514", exception);
        }
    }

    private List<BookAuthor> parseAuthors(String json) throws SQLException {
        JsonNode value = parseArray(json, "authors_json");
        return java.util.stream.StreamSupport.stream(value.spliterator(), false)
                .map(author -> new BookAuthor(author.path("authorId").asText(), author.path("name").asText(),
                        author.path("order").asInt())).toList();
    }

    private List<BookCategory> parseCategories(String json) throws SQLException {
        JsonNode value = parseArray(json, "categories_json");
        return java.util.stream.StreamSupport.stream(value.spliterator(), false)
                .map(category -> new BookCategory(category.path("categoryId").asText(),
                        category.path("name").asText(), category.path("slug").asText())).toList();
    }

    private JsonNode parseArray(String json, String column) throws SQLException {
        try {
            JsonNode value = objectMapper.readTree(json);
            if (value == null || !value.isArray()) throw new SQLException("Function returned invalid " + column, "23514");
            return value;
        } catch (JacksonException exception) { throw new SQLException("Function returned invalid " + column, "23514", exception); }
    }

    private static String id(ResultSet rs, String column) throws SQLException { return Long.toString(rs.getLong(column)); }
    private static String nullableId(ResultSet rs, String column) throws SQLException {
        long id = rs.getLong(column); return rs.wasNull() ? null : Long.toString(id);
    }
    private static String timestamp(ResultSet rs, String column) throws SQLException {
        OffsetDateTime value = rs.getObject(column, OffsetDateTime.class); return value == null ? null : value.toString();
    }
    private static void nullableString(PreparedStatement statement, int index, String value) throws SQLException {
        if (value == null) statement.setNull(index, Types.VARCHAR); else statement.setString(index, value);
    }
    private static void nullableLong(PreparedStatement statement, int index, Long value) throws SQLException {
        if (value == null) statement.setNull(index, Types.BIGINT); else statement.setLong(index, value);
    }
    private static void nullableDate(PreparedStatement statement, int index, LocalDate value) throws SQLException {
        if (value == null) statement.setNull(index, Types.DATE); else statement.setDate(index, Date.valueOf(value));
    }

    @FunctionalInterface private interface StatementBinder { void bind(PreparedStatement statement) throws SQLException; }
    private record Counted<T>(T value, long totalCount) { }
    private record JsonBookAuthor(long authorId, int order) { }
}
