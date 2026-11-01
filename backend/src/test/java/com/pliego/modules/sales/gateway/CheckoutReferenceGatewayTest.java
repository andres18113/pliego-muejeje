package com.pliego.modules.sales.gateway;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

import java.math.BigDecimal;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

import com.pliego.foundation.database.DatabaseExceptionTranslator;
import com.pliego.foundation.money.MonetaryAmounts;
import com.pliego.modules.sales.application.PostPurchaseModels;
import tools.jackson.databind.ObjectMapper;

@ExtendWith(MockitoExtension.class)
class CheckoutReferenceGatewayTest {
    @Mock JdbcTemplate jdbc;
    @Mock Connection connection;
    @Mock PreparedStatement statement;
    @Mock ResultSet output;

    @Test
    void checkoutAndIdempotentReplayReadTheImmutablePublicReferenceFromTheDatabaseApi() throws Exception {
        when(jdbc.execute(any(ConnectionCallback.class)))
                .thenAnswer(call -> ((ConnectionCallback<?>) call.getArgument(0)).doInConnection(connection));
        when(connection.prepareStatement(contains("sp_checkout_quoted"))).thenReturn(statement);
        when(statement.executeQuery()).thenReturn(output);
        when(output.next()).thenReturn(true);
        when(output.getLong("o_order_id")).thenReturn(700L);
        when(output.getString("o_order_state")).thenReturn("CONFIRMED");
        when(output.getString("o_payment_state")).thenReturn("APPROVED");
        when(output.getBigDecimal("o_total")).thenReturn(new BigDecimal("39.80"));
        when(output.getString("o_payment_reference")).thenReturn("SIM-existing");
        when(jdbc.queryForObject(contains("fn_order_pricing"), any(RowMapper.class), eq(700L)))
                .thenReturn(new MonetaryAmounts(new BigDecimal("39.80"), BigDecimal.ZERO, BigDecimal.ZERO,
                        BigDecimal.ZERO, new BigDecimal("39.80")));
        when(jdbc.queryForObject(contains("fn_order_offer_pricing"), any(RowMapper.class), eq(700L)))
                .thenReturn(PostPurchaseModels.OfferPricing.unavailable());
        when(jdbc.queryForObject(contains("fn_order_fulfillment"), eq(String.class), eq(700L))).thenReturn(null);
        when(jdbc.queryForObject(contains("fn_order_reference"), eq(String.class), eq(700L)))
                .thenReturn("PL-0123-4567");
        var gateway = new JdbcCheckoutGateway(new DatabaseExceptionTranslator(), jdbc, new ObjectMapper());
        var key = UUID.randomUUID();
        var first = gateway.checkout(42L, key, null, "TRANSFER", "APPROVED", 1L, "DIGITAL", null);
        var replay = gateway.checkout(42L, key, null, "TRANSFER", "APPROVED", 1L, "DIGITAL", null);
        assertThat(first.orderReference()).isEqualTo("PL-0123-4567");
        assertThat(replay.orderReference()).isEqualTo("PL-0123-4567");
        assertThat(replay.orderId()).isEqualTo(first.orderId());
    }
}
