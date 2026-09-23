package com.pliego.modules.customer.gateway;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Types;
import java.util.List;

import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import com.pliego.foundation.database.DatabaseExceptionTranslator;
import com.pliego.foundation.database.JdbcGatewaySupport;
import com.pliego.modules.customer.gateway.CustomerGateway.AddressData;
import com.pliego.modules.customer.gateway.CustomerGateway.CustomerAddress;
import com.pliego.modules.customer.gateway.CustomerGateway.CustomerProfile;

/** Calls only the approved customer profile and address Database API routines. */
@Repository
public class JdbcCustomerGateway extends JdbcGatewaySupport implements CustomerGateway {

    private static final String PROFILE_QUERY = "SELECT customer_id, email, first_names, last_names, phone, state "
            + "FROM pliego.fn_customer_profile(?)";
    private static final String PROFILE_UPDATE_CALL = "CALL pliego.sp_customer_update(?,?,?,?)";
    private static final String ADDRESS_LIST_QUERY = "SELECT address_id, alias, recipient, line1, line2, city, "
            + "province, country_code, postal_code, reference, phone, is_primary "
            + "FROM pliego.fn_address_list(?)";
    private static final String ADDRESS_CREATE_CALL = "CALL pliego.sp_address_create(?,?,?,?,?,?,?,?,?,?,?,?,?)";
    private static final String ADDRESS_UPDATE_CALL = "CALL pliego.sp_address_update(?,?,?,?,?,?,?,?,?,?,?,?)";
    private static final String ADDRESS_DELETE_CALL = "CALL pliego.sp_address_delete(?,?)";
    private static final String ADDRESS_SET_PRIMARY_CALL = "CALL pliego.sp_address_set_primary(?,?)";

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
                                results.getString("phone"), results.getString("state"))
                        : null));
    }

    @Override
    public void updateProfile(long actorUserId, String firstNames, String lastNames, String phone) {
        executeNoOutput(PROFILE_UPDATE_CALL, statement -> {
            statement.setLong(1, actorUserId);
            statement.setString(2, firstNames);
            statement.setString(3, lastNames);
            setNullableString(statement, 4, phone);
        });
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
    public long createAddress(long actorUserId, AddressData address, boolean makePrimary) {
        return withDatabaseErrorTranslation(() -> jdbcTemplate.execute(
                (ConnectionCallback<Long>) connection -> {
                    try (PreparedStatement statement = connection.prepareStatement(ADDRESS_CREATE_CALL)) {
                        statement.setLong(1, actorUserId);
                        bindAddress(statement, 2, address);
                        statement.setBoolean(12, makePrimary);
                        statement.setNull(13, Types.BIGINT);
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
