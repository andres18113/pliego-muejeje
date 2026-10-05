package com.pliego.modules.customer.gateway;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Types;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import com.pliego.modules.customer.application.AddressAttempt;
import java.util.stream.Collectors;

import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import com.pliego.foundation.database.DatabaseExceptionTranslator;
import com.pliego.foundation.database.JdbcGatewaySupport;
import com.pliego.modules.customer.gateway.CustomerGateway.AddressData;
import com.pliego.modules.customer.gateway.CustomerGateway.CustomerAddress;
import com.pliego.modules.customer.gateway.CustomerGateway.CustomerProfile;
import com.pliego.modules.customer.application.CustomerFavorites.Favorite;
import com.pliego.modules.customer.application.CustomerFavorites.Page;
import com.pliego.modules.customer.application.CustomerFavorites.Status;

/** Calls only the approved customer profile and address Database API routines. */
@Repository
public class JdbcCustomerGateway extends JdbcGatewaySupport implements CustomerGateway {

    private static final String PROFILE_QUERY = "SELECT * FROM pliego.fn_customer_profile_versioned(?)";
    private static final String PROFILE_UPDATE_CALL = "CALL pliego.sp_customer_update_versioned(?,?,?,?,?)";
    private static final String PASSWORD_HASH_QUERY = "SELECT pliego.fn_customer_password_hash(?) AS password_hash";
    private static final String EMAIL_CHANGE_CALL = "CALL pliego.sp_customer_change_email(?,?,?)";
    private static final String ADDRESS_LIST_QUERY = "SELECT address_id, alias, recipient, line1, line2, city, "
            + "province, country_code, postal_code, reference, phone, is_primary "
            + "FROM pliego.fn_address_list(?)";
    private static final String ADDRESS_CREATE_CALL = "CALL pliego.sp_address_create_idempotent(?,?,?,?,?,?,?,?,?,?,?,?,?,?)";
    private static final String ADDRESS_UPDATE_CALL = "CALL pliego.sp_address_update(?,?,?,?,?,?,?,?,?,?,?,?)";
    private static final String ADDRESS_DELETE_CALL = "CALL pliego.sp_address_delete(?,?)";
    private static final String ADDRESS_SET_PRIMARY_CALL = "CALL pliego.sp_address_set_primary(?,?)";
    private static final String FAVORITES_QUERY = "SELECT edition_id, book_id, title, authors, publisher, price, "
            + "cover_url, cover_license, cover_attribution, format, language, available, favorited_at, total_count "
            + "FROM pliego.fn_customer_favorites(?,?,?)";
    private static final String FAVORITE_STATUS_QUERY = "SELECT edition_id, favorite "
            + "FROM pliego.fn_customer_favorite_status(?, string_to_array(?, ',')::BIGINT[])";
    private static final String FAVORITE_ADD_CALL = "CALL pliego.sp_customer_favorite_add(?,?)";
    private static final String FAVORITE_REMOVE_CALL = "CALL pliego.sp_customer_favorite_remove(?,?)";

    private final JdbcTemplate jdbcTemplate;

    public JdbcCustomerGateway(DatabaseExceptionTranslator exceptionTranslator, JdbcTemplate jdbcTemplate) {
        super(exceptionTranslator);
        this.jdbcTemplate = jdbcTemplate;
    }

    @Override
    public CustomerProfile findProfile(long actorUserId) {
        return withDatabaseErrorTranslation(() -> jdbcTemplate.query(PROFILE_QUERY,
                statement -> statement.setLong(1, actorUserId), results -> results.next()
                        ? new CustomerProfile(results.getLong("customer_id"), results.getString("email"),
                                results.getString("first_names"), results.getString("last_names"),
                                results.getString("phone"), results.getString("state"), results.getLong("version"))
                        : null));
    }

    @Override
    public void updateProfile(long actorUserId, long expectedVersion, String firstNames, String lastNames, String phone) {
        executeNoOutput(PROFILE_UPDATE_CALL, statement -> {
            statement.setLong(1, actorUserId);
            statement.setLong(2, expectedVersion);
            statement.setString(3, firstNames);
            statement.setString(4, lastNames);
            setNullableString(statement, 5, phone);
        });
    }

    @Override
    public void patchProfile(long actorUserId, long expectedVersion, String field, String value) {
        executeNoOutput("CALL pliego.sp_customer_patch(?,?,?,?)", statement -> {
            statement.setLong(1, actorUserId); statement.setLong(2, expectedVersion);
            statement.setString(3, field); setNullableString(statement, 4, value);
        });
    }

    @Override
    public AddressAttempt resolveAddress(long actorUserId, UUID key) {
        return withDatabaseErrorTranslation(() -> jdbcTemplate.query(
                "SELECT * FROM pliego.fn_address_create_resolve(?,?)", statement -> {
                    statement.setLong(1, actorUserId); statement.setObject(2, key);
                }, results -> {
                    if (!results.next()) throw new SQLException("Address resolution returned no output", "02000");
                    return new AddressAttempt(results.getString("state"), results.getString("address_id"));
                }));
    }

    @Override
    public String passwordHash(long actorUserId) {
        return withDatabaseErrorTranslation(() -> jdbcTemplate.query(PASSWORD_HASH_QUERY,
                statement -> statement.setLong(1, actorUserId),
                results -> results.next() ? results.getString("password_hash") : null));
    }

    @Override
    public String changeEmail(long actorUserId, String newEmail) {
        return withDatabaseErrorTranslation(() -> jdbcTemplate.execute(
                (ConnectionCallback<String>) connection -> {
                    try (PreparedStatement statement = connection.prepareStatement(EMAIL_CHANGE_CALL)) {
                        statement.setLong(1, actorUserId);
                        statement.setString(2, newEmail);
                        statement.setNull(3, Types.VARCHAR);
                        try (ResultSet outputs = statement.executeQuery()) {
                            if (!outputs.next()) {
                                throw new SQLException("sp_customer_change_email returned no result", "02000");
                            }
                            return outputs.getString("o_email");
                        }
                    }
                }));
    }

    @Override
    public List<CustomerAddress> listAddresses(long actorUserId) {
        return withDatabaseErrorTranslation(() -> jdbcTemplate.query(ADDRESS_LIST_QUERY,
                statement -> statement.setLong(1, actorUserId), (results, rowNumber) -> new CustomerAddress(
                        results.getLong("address_id"), results.getString("alias"), results.getString("recipient"),
                        results.getString("line1"), results.getString("line2"), results.getString("city"),
                        results.getString("province"), results.getString("country_code"),
                        results.getString("postal_code"), results.getString("reference"),
                        results.getString("phone"), results.getBoolean("is_primary"))));
    }

    @Override
    public long createAddress(long actorUserId, UUID key, AddressData address, boolean makePrimary) {
        return withDatabaseErrorTranslation(() -> jdbcTemplate.execute(
                (ConnectionCallback<Long>) connection -> {
                    try (PreparedStatement statement = connection.prepareStatement(ADDRESS_CREATE_CALL)) {
                        statement.setLong(1, actorUserId);
                        statement.setObject(2, key);
                        bindAddress(statement, 3, address);
                        statement.setBoolean(13, makePrimary);
                        statement.setNull(14, Types.BIGINT);
                        try (ResultSet outputs = statement.executeQuery()) {
                            if (!outputs.next()) {
                                throw new SQLException("sp_address_create returned no result", "02000");
                            }
                            return outputs.getLong("o_address_id");
                        }
                    }
                }));
    }

    @Override
    public void updateAddress(long actorUserId, long addressId, AddressData address) {
        executeNoOutput(ADDRESS_UPDATE_CALL, statement -> {
            statement.setLong(1, actorUserId);
            statement.setLong(2, addressId);
            bindAddress(statement, 3, address);
        });
    }

    @Override
    public void deleteAddress(long actorUserId, long addressId) {
        executeNoOutput(ADDRESS_DELETE_CALL, statement -> {
            statement.setLong(1, actorUserId);
            statement.setLong(2, addressId);
        });
    }

    @Override
    public void setPrimaryAddress(long actorUserId, long addressId) {
        executeNoOutput(ADDRESS_SET_PRIMARY_CALL, statement -> {
            statement.setLong(1, actorUserId);
            statement.setLong(2, addressId);
        });
    }

    @Override
    public Page listFavorites(long actorUserId, int page, int pageSize) {
        return withDatabaseErrorTranslation(() -> {
            List<FavoriteRow> rows = readFavoriteRows(actorUserId, page, pageSize);
            long totalCount = rows.isEmpty() && page > 0
                    ? readFavoriteRows(actorUserId, 0, pageSize).stream().findFirst()
                            .map(FavoriteRow::totalCount).orElse(0L)
                    : rows.stream().findFirst().map(FavoriteRow::totalCount).orElse(0L);
            return new Page(rows.stream().map(FavoriteRow::favorite).toList(), totalCount);
        });
    }

    @Override
    public List<Status> favoriteStatus(long actorUserId, List<Long> editionIds) {
        String ids = editionIds.stream().distinct().map(String::valueOf).collect(Collectors.joining(","));
        return withDatabaseErrorTranslation(() -> jdbcTemplate.query(FAVORITE_STATUS_QUERY,
                statement -> {
                    statement.setLong(1, actorUserId);
                    statement.setString(2, ids);
                }, (results, rowNumber) -> new Status(results.getLong("edition_id"),
                        results.getBoolean("favorite"))));
    }

    @Override
    public void addFavorite(long actorUserId, long editionId) {
        executeNoOutput(FAVORITE_ADD_CALL, statement -> {
            statement.setLong(1, actorUserId);
            statement.setLong(2, editionId);
        });
    }

    @Override
    public void removeFavorite(long actorUserId, long editionId) {
        executeNoOutput(FAVORITE_REMOVE_CALL, statement -> {
            statement.setLong(1, actorUserId);
            statement.setLong(2, editionId);
        });
    }

    private List<FavoriteRow> readFavoriteRows(long actorUserId, int page, int pageSize) {
        return jdbcTemplate.query(FAVORITES_QUERY, statement -> {
            statement.setLong(1, actorUserId);
            statement.setInt(2, page);
            statement.setInt(3, pageSize);
        }, (results, rowNumber) -> {
            Favorite favorite = new Favorite(results.getLong("edition_id"), results.getLong("book_id"),
                    results.getString("title"), results.getString("authors"), results.getString("publisher"),
                    results.getBigDecimal("price"), results.getString("cover_url"),
                    results.getString("cover_license"), results.getString("cover_attribution"),
                    results.getString("format"), results.getString("language"), results.getBoolean("available"),
                    results.getTimestamp("favorited_at").toInstant());
            return new FavoriteRow(favorite, results.getLong("total_count"));
        });
    }

    private record FavoriteRow(Favorite favorite, long totalCount) { }

    private void executeNoOutput(String call, StatementBinder binder) {
        withDatabaseErrorTranslation(() -> jdbcTemplate.execute((ConnectionCallback<Void>) connection -> {
            try (PreparedStatement statement = connection.prepareStatement(call)) {
                binder.bind(statement);
                statement.execute();
                return null;
            }
        }));
    }

    private static void bindAddress(PreparedStatement statement, int firstIndex, AddressData address)
            throws SQLException {
        statement.setString(firstIndex, address.alias());
        statement.setString(firstIndex + 1, address.recipient());
        statement.setString(firstIndex + 2, address.line1());
        setNullableString(statement, firstIndex + 3, address.line2());
        statement.setString(firstIndex + 4, address.city());
        statement.setString(firstIndex + 5, address.province());
        statement.setString(firstIndex + 6, address.countryCode());
        setNullableString(statement, firstIndex + 7, address.postalCode());
        setNullableString(statement, firstIndex + 8, address.reference());
        statement.setString(firstIndex + 9, address.phone());
    }

    private static void setNullableString(PreparedStatement statement, int index, String value) throws SQLException {
        if (value == null) statement.setNull(index, Types.VARCHAR);
        else statement.setString(index, value);
    }

    @FunctionalInterface
    private interface StatementBinder {
        void bind(PreparedStatement statement) throws SQLException;
    }
}
