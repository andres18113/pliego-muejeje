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
import com.pliego.modules.sales.application.CheckoutAttempt;
import java.util.UUID;

/** Calls only the approved checkout Procedure. No card number enters this boundary. */
@Repository
public class JdbcCheckoutGateway extends JdbcGatewaySupport implements CheckoutGateway {

    private static final String CHECKOUT = "CALL pliego.sp_checkout_idempotent(?,?,?,?,?,?,?,?,?,?,?,?,?)";
    private final JdbcTemplate jdbcTemplate;
    private final tools.jackson.databind.ObjectMapper objectMapper;

    public JdbcCheckoutGateway(DatabaseExceptionTranslator exceptionTranslator, JdbcTemplate jdbcTemplate,
            tools.jackson.databind.ObjectMapper objectMapper) {
        super(exceptionTranslator);
        this.jdbcTemplate = jdbcTemplate;
        this.objectMapper = objectMapper;
    }

    @Override
    public CheckoutResult checkout(long actorUserId, UUID key, Long addressId, String paymentMethod, String paymentOutcome,
            Long cartId, String fulfillmentMethod, Long pickupLocationId) {
        return withDatabaseErrorTranslation(() -> jdbcTemplate.execute((ConnectionCallback<CheckoutResult>) connection -> {
            try (PreparedStatement statement = connection.prepareStatement(CHECKOUT)) {
                statement.setLong(1, actorUserId);
                statement.setObject(2, key);
                if (addressId == null) statement.setNull(3, Types.BIGINT); else statement.setLong(3, addressId);
                statement.setString(4, paymentMethod);
                statement.setString(5, paymentOutcome);
                if (cartId == null) statement.setNull(6, Types.BIGINT); else statement.setLong(6, cartId);
                statement.setString(7, fulfillmentMethod);
                if (pickupLocationId == null) statement.setNull(8, Types.BIGINT); else statement.setLong(8, pickupLocationId);
                statement.setNull(9, Types.BIGINT);
                statement.setNull(10, Types.VARCHAR);
                statement.setNull(11, Types.VARCHAR);
                statement.setNull(12, Types.NUMERIC);
                statement.setNull(13, Types.VARCHAR);
                try (ResultSet output = statement.executeQuery()) {
                    if (!output.next()) throw new SQLException("Checkout Procedure returned no output", "02000");
                    return new CheckoutResult(Long.toString(output.getLong("o_order_id")),
                            output.getString("o_order_state"), output.getString("o_payment_state"),
                            output.getBigDecimal("o_total"), output.getString("o_payment_reference"), fulfillment(output.getLong("o_order_id")),amounts(output.getLong("o_order_id")));
                }
            }
        }));
    }

    @Override
    public CheckoutAttempt resolve(long actorUserId, UUID key) {
        return withDatabaseErrorTranslation(() -> jdbcTemplate.query(
                "SELECT * FROM pliego.fn_checkout_resolve(?,?)", statement -> {
                    statement.setLong(1, actorUserId); statement.setObject(2, key);
                }, results -> {
                    if (!results.next()) throw new SQLException("Checkout resolution returned no output", "02000");
                    String state = results.getString("state");
                    CheckoutResult order = "CREATED".equals(state) ? new CheckoutResult(
                            Long.toString(results.getLong("order_id")), results.getString("order_state"),
                            results.getString("payment_state"), results.getBigDecimal("total"),
                            results.getString("payment_reference"), fulfillment(results.getLong("order_id")),amounts(results.getLong("order_id"))) : null;
                    return new CheckoutAttempt(state, order);
                }));
    }
    private com.pliego.modules.sales.application.PostPurchaseModels.Fulfillment fulfillment(long orderId) throws SQLException {
        String value=jdbcTemplate.queryForObject("SELECT pliego.fn_order_fulfillment(?,TRUE)::text",String.class,orderId);
        if(value==null)return null;
        try {return objectMapper.readValue(value,com.pliego.modules.sales.application.PostPurchaseModels.Fulfillment.class);}
        catch(tools.jackson.core.JacksonException error) {throw new SQLException("Invalid checkout fulfillment projection","XX000",error);}
    }
    private com.pliego.foundation.money.MonetaryAmounts amounts(long orderId) {
        return jdbcTemplate.queryForObject("SELECT * FROM pliego.fn_order_pricing(?)",(rs,n)->new com.pliego.foundation.money.MonetaryAmounts(
                rs.getBigDecimal("subtotal"),rs.getBigDecimal("tax_rate"),rs.getBigDecimal("tax_amount"),rs.getBigDecimal("shipping_amount"),rs.getBigDecimal("total")),orderId);
    }
}
