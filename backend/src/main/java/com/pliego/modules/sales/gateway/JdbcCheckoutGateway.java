package com.pliego.modules.sales.gateway;

import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Types;

import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import com.pliego.foundation.database.DatabaseExceptionTranslator;
import com.pliego.foundation.database.JdbcGatewaySupport;
import com.pliego.modules.sales.application.CheckoutResult;

/** Calls only the approved checkout Procedure. No card number enters this boundary. */
@Repository
public class JdbcCheckoutGateway extends JdbcGatewaySupport implements CheckoutGateway {

    private static final String CHECKOUT = "CALL pliego.sp_checkout(?,?,?,?,?,?,?,?,?)";
    private final JdbcTemplate jdbcTemplate;

    public JdbcCheckoutGateway(DatabaseExceptionTranslator exceptionTranslator, JdbcTemplate jdbcTemplate) {
        super(exceptionTranslator);
        this.jdbcTemplate = jdbcTemplate;
    }

    @Override
    public CheckoutResult checkout(long actorUserId, long addressId, String paymentMethod, String paymentOutcome) {
        return withDatabaseErrorTranslation(() -> jdbcTemplate.execute((ConnectionCallback<CheckoutResult>) connection -> {
            try (PreparedStatement statement = connection.prepareStatement(CHECKOUT)) {
                statement.setLong(1, actorUserId);
                statement.setLong(2, addressId);
                statement.setString(3, paymentMethod);
                statement.setString(4, paymentOutcome);
                statement.setNull(5, Types.BIGINT);
                statement.setNull(6, Types.VARCHAR);
                statement.setNull(7, Types.VARCHAR);
                statement.setNull(8, Types.NUMERIC);
                statement.setNull(9, Types.VARCHAR);
                try (ResultSet output = statement.executeQuery()) {
                    if (!output.next()) throw new SQLException("Checkout Procedure returned no output", "02000");
                    return new CheckoutResult(Long.toString(output.getLong("o_order_id")),
                            output.getString("o_order_state"), output.getString("o_payment_state"),
                            output.getBigDecimal("o_total"), output.getString("o_payment_reference"));
                }
            }
        }));
    }
}
