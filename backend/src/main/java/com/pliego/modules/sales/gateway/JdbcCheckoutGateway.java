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

    private static final String CHECKOUT = "CALL pliego.sp_checkout_quoted(?,?,?,?,?,?,?,?,?,?,?,?,?,?)";
    private static final String CHECKOUT_BILLED = "CALL pliego.sp_checkout_billed_quoted(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)";
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
        return checkout(actorUserId,key,addressId,paymentMethod,paymentOutcome,cartId,fulfillmentMethod,pickupLocationId,null);
    }

    @Override
    public CheckoutResult checkout(long actorUserId, UUID key, Long addressId, String paymentMethod, String paymentOutcome,
            Long cartId, String fulfillmentMethod, Long pickupLocationId, String quoteFingerprint) {
        return executeCheckout(actorUserId,key,addressId,paymentMethod,paymentOutcome,cartId,fulfillmentMethod,pickupLocationId,quoteFingerprint,null);
    }

    @Override
    public CheckoutResult checkoutBilled(long actorUserId, UUID key, Long addressId, String paymentMethod,
            String paymentOutcome, Long cartId, String fulfillmentMethod, Long pickupLocationId,
            String quoteFingerprint, com.pliego.modules.sales.application.PostPurchaseModels.CheckoutBilling billing) {
        return executeCheckout(actorUserId,key,addressId,paymentMethod,paymentOutcome,cartId,fulfillmentMethod,pickupLocationId,quoteFingerprint,billing);
    }

    private CheckoutResult executeCheckout(long actorUserId, UUID key, Long addressId, String paymentMethod,
            String paymentOutcome, Long cartId, String fulfillmentMethod, Long pickupLocationId,
            String quoteFingerprint, com.pliego.modules.sales.application.PostPurchaseModels.CheckoutBilling billing) {
        return withDatabaseErrorTranslation(() -> jdbcTemplate.execute((ConnectionCallback<CheckoutResult>) connection -> {
            try (PreparedStatement statement = connection.prepareStatement(billing == null ? CHECKOUT : CHECKOUT_BILLED)) {
                statement.setLong(1, actorUserId);
                statement.setObject(2, key);
                if (addressId == null) statement.setNull(3, Types.BIGINT); else statement.setLong(3, addressId);
                statement.setString(4, paymentMethod);
                statement.setString(5, paymentOutcome);
                if (cartId == null) statement.setNull(6, Types.BIGINT); else statement.setLong(6, cartId);
                statement.setString(7, fulfillmentMethod);
                if (pickupLocationId == null) statement.setNull(8, Types.BIGINT); else statement.setLong(8, pickupLocationId);
                statement.setString(9, quoteFingerprint);
                int outputStart = 10;
                if (billing != null) {
                    statement.setString(10, billing.identityType());
                    statement.setString(11, billing.identityNumber());
                    statement.setString(12, billing.buyerName());
                    statement.setString(13, billing.address().line1());
                    statement.setString(14, billing.address().line2());
                    statement.setString(15, billing.address().city());
                    statement.setString(16, billing.address().province());
                    statement.setString(17, billing.address().countryCode());
                    statement.setString(18, billing.address().postalCode());
                    outputStart = 19;
                    statement.setNull(24, Types.BIGINT);
                }
                statement.setNull(outputStart, Types.BIGINT);
                statement.setNull(outputStart + 1, Types.VARCHAR);
                statement.setNull(outputStart + 2, Types.VARCHAR);
                statement.setNull(outputStart + 3, Types.NUMERIC);
                statement.setNull(outputStart + 4, Types.VARCHAR);
                try (ResultSet output = statement.executeQuery()) {
                    if (!output.next()) throw new SQLException("Checkout Procedure returned no output", "02000");
                    return new CheckoutResult(Long.toString(output.getLong("o_order_id")),
                            output.getString("o_order_state"), output.getString("o_payment_state"),
                            output.getBigDecimal("o_total"), output.getString("o_payment_reference"), fulfillment(output.getLong("o_order_id")),amounts(output.getLong("o_order_id")),offerPricing(output.getLong("o_order_id")));
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
                            results.getString("payment_reference"), fulfillment(results.getLong("order_id")),amounts(results.getLong("order_id")),offerPricing(results.getLong("order_id"))) : null;
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
    private com.pliego.modules.sales.application.PostPurchaseModels.OfferPricing offerPricing(long orderId) {
        return jdbcTemplate.queryForObject("SELECT * FROM pliego.fn_order_offer_pricing(?)",
                (rs, n) -> PostPurchaseRowMapper.offerPricing(rs), orderId);
    }
}
