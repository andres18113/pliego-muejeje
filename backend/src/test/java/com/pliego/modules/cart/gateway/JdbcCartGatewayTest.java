package com.pliego.modules.cart.gateway;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

import com.pliego.foundation.database.DatabaseExceptionTranslator;
import com.pliego.modules.cart.application.CartModels.Cart;

import tools.jackson.databind.ObjectMapper;

class JdbcCartGatewayTest {

    @Test
    void cartOfferQuoteMonetaryColumnsAndItemJsonAreForwardedWithoutRecalculation() throws Exception {
        var jdbc = mock(JdbcTemplate.class);
        var row = mock(ResultSet.class);
        when(row.getLong("cart_id")).thenReturn(40L);
        when(row.getString("state")).thenReturn("ACTIVE");
        when(row.getString("items")).thenReturn("""
                [{"cartItemId":"100","editionId":"250","title":"1984","authors":"George Orwell",
                  "sku":"PHYSICAL","coverUrl":null,"quantity":3,"currentPrice":19.90,"currentSubtotal":59.69,
                  "available":true,"unavailabilityReason":null,"format":"PAPERBACK",
                  "requiresPhysicalFulfillment":true,"quantityEditable":true,
                  "originalPrice":22.15,"unitSavings":2.26,"originalSubtotal":66.46,"lineSavings":6.77}]
                """);
        for (var amount : Map.of("total_current", "68.64", "subtotal", "59.69", "tax_rate", "15.00",
                "tax_amount", "8.95", "shipping_amount", "0.00", "total", "68.64",
                "original_subtotal", "66.46", "savings_total", "6.77", "current_subtotal", "59.69").entrySet()) {
            when(row.getBigDecimal(amount.getKey())).thenReturn(new BigDecimal(amount.getValue()));
        }
        when(row.getBoolean("requires_physical_fulfillment")).thenReturn(true);
        when(row.getInt("physical_item_count")).thenReturn(3);
        when(row.getString("quote_fingerprint")).thenReturn("a".repeat(64));
        when(jdbc.queryForObject(contains("FROM pliego.fn_cart_checkout_quote(?)"),
                org.mockito.ArgumentMatchers.<RowMapper<Cart>>any(), eq(42L), eq(42L), eq(42L)))
                .thenAnswer(invocation -> {
                    RowMapper<Cart> mapper = invocation.getArgument(1);
                    return mapper.mapRow(row, 0);
                });

        var gateway = new JdbcCartGateway(new DatabaseExceptionTranslator(), jdbc, new ObjectMapper());
        var cart = gateway.get(42L);

        assertNotNull(cart, "Cart read must use the offer-aware Database API routine");
        assertEquals("a".repeat(64), cart.quoteFingerprint());
        assertEquals(new BigDecimal("66.46"), cart.originalSubtotal());
        assertEquals(new BigDecimal("6.77"), cart.savingsTotal());
        assertEquals(new BigDecimal("59.69"), cart.currentSubtotal());
        assertEquals(new BigDecimal("59.69"), cart.amounts().subtotal());
        assertEquals(new BigDecimal("68.64"), cart.totalCurrent());
        assertEquals(3, cart.physicalItemCount());
        var item = cart.items().getFirst();
        assertEquals(3, item.quantity());
        assertEquals(new BigDecimal("22.15"), item.originalPrice());
        assertEquals(0, new BigDecimal("19.90").compareTo(item.currentPrice()));
        assertEquals(new BigDecimal("2.26"), item.unitSavings());
        assertEquals(new BigDecimal("66.46"), item.originalSubtotal());
        assertEquals(new BigDecimal("6.77"), item.lineSavings());
        assertEquals(new BigDecimal("59.69"), item.currentSubtotal());
    }
}
