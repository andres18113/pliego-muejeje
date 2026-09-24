package com.pliego.modules.customer.gateway;

import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Types;
import java.time.OffsetDateTime;
import java.util.List;

import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import com.pliego.foundation.database.DatabaseExceptionTranslator;
import com.pliego.foundation.database.JdbcGatewaySupport;
import com.pliego.modules.customer.application.AdminCustomerModels.CustomerSummary;
import com.pliego.modules.customer.application.AdminCustomerModels.Page;
import com.pliego.modules.customer.application.AdminCustomerModels.Search;

/** Calls only fn_admin_customer_search and sp_customer_set_status. */
@Repository
public class JdbcAdminCustomerGateway extends JdbcGatewaySupport implements AdminCustomerGateway {
    private static final String SEARCH = "SELECT customer_id,email,first_names,last_names,phone,state,created_at,total_count "
            + "FROM pliego.fn_admin_customer_search(?,?,?,?,?)";
    private static final String SET_STATUS = "CALL pliego.sp_customer_set_status(?,?,?,?,?,?)";

    private final JdbcTemplate jdbcTemplate;

    public JdbcAdminCustomerGateway(DatabaseExceptionTranslator exceptionTranslator, JdbcTemplate jdbcTemplate) {
        super(exceptionTranslator);
        this.jdbcTemplate = jdbcTemplate;
    }

    @Override
    public Page search(long actorUserId, Search search) {
        return withDatabaseErrorTranslation(() -> {
            List<CountedCustomer> rows = searchRows(actorUserId, search, search.page());
            long totalCount = rows.isEmpty() && search.page() > 0
                    ? firstCount(searchRows(actorUserId, search, 0)) : firstCount(rows);
            return new Page(rows.stream().map(CountedCustomer::customer).toList(), totalCount);
        });
    }

    private List<CountedCustomer> searchRows(long actorUserId, Search search, int page) {
        return jdbcTemplate.query(SEARCH, statement -> {
            statement.setLong(1, actorUserId);
            nullableString(statement, 2, search.query());
            nullableString(statement, 3, search.state());
            statement.setInt(4, page);
            statement.setInt(5, search.pageSize());
        }, (rs, row) -> new CountedCustomer(new CustomerSummary(Long.toString(rs.getLong("customer_id")),
                rs.getString("email"), rs.getString("first_names"), rs.getString("last_names"),
                rs.getString("phone"), rs.getString("state"), timestamp(rs, "created_at")),
                rs.getLong("total_count")));
    }

    @Override
    public void setStatus(long actorUserId, long customerId, String state) {
        withDatabaseErrorTranslation(() -> jdbcTemplate.execute((ConnectionCallback<Void>) connection -> {
            try (PreparedStatement statement = connection.prepareStatement(SET_STATUS)) {
                statement.setLong(1, actorUserId);
                statement.setLong(2, customerId);
                statement.setString(3, state);
                statement.setNull(4, Types.BIGINT);
                statement.setNull(5, Types.BIGINT);
                statement.setNull(6, Types.VARCHAR);
                try (ResultSet output = statement.executeQuery()) {
                    if (!output.next()) {
                        throw new SQLException("sp_customer_set_status returned no result", "02000");
                    }
                }
                return null;
            }
        }));
    }

    private static long firstCount(List<CountedCustomer> rows) {
        return rows.isEmpty() ? 0 : rows.getFirst().totalCount();
    }

    private static String timestamp(ResultSet results, String column) throws SQLException {
        return results.getObject(column, OffsetDateTime.class).toInstant().toString();
    }

    private static void nullableString(PreparedStatement statement, int index, String value) throws SQLException {
        if (value == null) statement.setNull(index, Types.VARCHAR);
        else statement.setString(index, value);
    }

    private record CountedCustomer(CustomerSummary customer, long totalCount) { }
}
