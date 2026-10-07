package com.pliego.modules.sales.gateway;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.PreparedStatementSetter;
import org.springframework.jdbc.core.ResultSetExtractor;
import org.springframework.jdbc.core.RowMapper;

import com.pliego.foundation.database.DatabaseExceptionTranslator;
import com.pliego.modules.sales.application.CheckoutAttempt;
import com.pliego.modules.sales.application.OrderModels.Detail;
import tools.jackson.databind.ObjectMapper;

class HistoricalOrderPricingGatewayTest {

    @Test
    void customerListReadsPaidBreakdownFromOrderPricingRoutine() throws Exception {
        var jdbc = mock(JdbcTemplate.class);
        var row = orderRow();
        when(row.getString("item_summary")).thenReturn("[]");
        when(row.getString("payment_state")).thenReturn("APPROVED");
        when(row.getLong("total_count")).thenReturn(1L);
        when(jdbc.query(anyString(), org.mockito.ArgumentMatchers.<PreparedStatementSetter>any(),
                org.mockito.ArgumentMatchers.<RowMapper<Object>>any()))
                .thenAnswer(invocation -> {
                    String sql = invocation.getArgument(0);
                    assertTrue(sql.contains("pliego.fn_order_pricing"), "Customer list must use the saved paid-breakdown Database API routine");
                    RowMapper<?> mapper = invocation.getArgument(2);
                    return java.util.List.of(mapper.mapRow(row, 0));
                });

        var page = new JdbcCustomerOrderGateway(new DatabaseExceptionTranslator(), jdbc, new ObjectMapper()).list(42L, 0, 20);
        var summary = page.items().getFirst();

        assertEquals(1L, page.totalCount());
        assertEquals(new BigDecimal("45.77"), summary.total());
        var amounts = summary.postPurchase().amounts();
        assertNotNull(amounts);
        assertEquals(new BigDecimal("39.80"), amounts.subtotal());
        assertEquals(new BigDecimal("15.00"), amounts.taxRate());
        assertEquals(new BigDecimal("5.97"), amounts.taxAmount());
        assertEquals(new BigDecimal("0.00"), amounts.shippingAmount());
        assertEquals(new BigDecimal("45.77"), amounts.total());
        assertEquals(new BigDecimal("44.31"), summary.postPurchase().offerPricing().originalSubtotal());
    }

    @Test
    void customerDetailUsesHistoricalRoutineAndForwardsLineSnapshots() throws Exception {
        var jdbc = mock(JdbcTemplate.class);
        var row = orderRow();
        when(row.getString("items")).thenReturn("""
                [{"orderItemId":"800","editionId":"250","sku":"PURCHASE-SKU","isbn":null,
                  "title":"Título al comprar","authors":"Autora al comprar","publisher":"Editorial al comprar",
                  "format":"PAPERBACK","language":"es","unitPrice":19.90,"quantity":2,"subtotal":39.80,
                  "requiresPhysicalFulfillment":true,"originalPrice":22.15,"unitSavings":2.26,
                  "originalSubtotal":44.31,"lineSavings":4.51,"pricingSnapshotAvailable":true}]
                """);
        when(jdbc.queryForObject(contains("fn_order_offer_pricing"),
                org.mockito.ArgumentMatchers.<RowMapper<Detail>>any(), eq(42L), eq(700L)))
                .thenAnswer(invocation -> {
                    RowMapper<Detail> mapper = invocation.getArgument(1);
                    return mapper.mapRow(row, 0);
                });

        var order = new JdbcCustomerOrderGateway(new DatabaseExceptionTranslator(), jdbc, new ObjectMapper()).detail(42L, 700L);

        assertNotNull(order, "Order detail must read the immutable offer-pricing Database API projection");
        assertTrue(order.postPurchase().offerPricing().pricingSnapshotAvailable());
        assertEquals(new BigDecimal("44.31"), order.postPurchase().offerPricing().originalSubtotal());
        assertEquals(new BigDecimal("4.51"), order.postPurchase().offerPricing().savingsTotal());
        assertEquals(new BigDecimal("39.80"), order.postPurchase().offerPricing().currentSubtotal());
        var item = order.items().getFirst();
        assertTrue(item.pricingSnapshotAvailable());
        assertEquals(new BigDecimal("22.15"), item.originalPrice());
        assertEquals(new BigDecimal("2.26"), item.unitSavings());
        assertEquals(new BigDecimal("44.31"), item.originalSubtotal());
        assertEquals(new BigDecimal("4.51"), item.lineSavings());
        assertEquals(0, new BigDecimal("19.90").compareTo(item.unitPrice()));
        assertEquals(0, new BigDecimal("39.80").compareTo(item.subtotal()));
    }

    @Test
    void legacyDetailKeepsPaidSubtotalAndLeavesUnknownSnapshotAmountsNull() throws Exception {
        var jdbc = mock(JdbcTemplate.class);
        var row = orderRow();
        when(row.getBoolean("pricing_snapshot_available")).thenReturn(false);
        when(row.getBigDecimal("original_subtotal")).thenReturn(null);
        when(row.getBigDecimal("savings_total")).thenReturn(null);
        when(row.getString("items")).thenReturn("""
                [{"orderItemId":"800","editionId":"250","sku":"PURCHASE-SKU","isbn":null,
                  "title":"Título al comprar","authors":"Autora al comprar","publisher":"Editorial al comprar",
                  "format":"PAPERBACK","language":"es","unitPrice":19.90,"quantity":2,"subtotal":39.80,
                  "requiresPhysicalFulfillment":true,"originalPrice":null,"unitSavings":null,
                  "originalSubtotal":null,"lineSavings":null,"pricingSnapshotAvailable":false}]
                """);
        when(jdbc.queryForObject(contains("fn_order_offer_pricing"),
                org.mockito.ArgumentMatchers.<RowMapper<Detail>>any(), eq(42L), eq(700L)))
                .thenAnswer(invocation -> {
                    RowMapper<Detail> mapper = invocation.getArgument(1);
                    return mapper.mapRow(row, 0);
                });

        var order = new JdbcCustomerOrderGateway(new DatabaseExceptionTranslator(), jdbc, new ObjectMapper()).detail(42L, 700L);

        assertFalse(order.postPurchase().offerPricing().pricingSnapshotAvailable());
        assertNull(order.postPurchase().offerPricing().originalSubtotal());
        assertNull(order.postPurchase().offerPricing().savingsTotal());
        assertEquals(new BigDecimal("39.80"), order.postPurchase().offerPricing().currentSubtotal());
        var item = order.items().getFirst();
        assertFalse(item.pricingSnapshotAvailable());
        assertNull(item.originalPrice());
        assertNull(item.unitSavings());
        assertNull(item.originalSubtotal());
        assertNull(item.lineSavings());
        assertEquals(0, new BigDecimal("19.90").compareTo(item.unitPrice()));
    }

    @Test
    void resolutionReadsSavedOfferPricingWithPaidTaxesAndTotal() throws Exception {
        var jdbc = mock(JdbcTemplate.class);
        var row = orderRow();
        when(row.next()).thenReturn(true);
        when(row.getString("state")).thenReturn("CREATED");
        when(row.getString("payment_state")).thenReturn("APPROVED");
        when(jdbc.query(anyString(), org.mockito.ArgumentMatchers.<PreparedStatementSetter>any(),
                org.mockito.ArgumentMatchers.<ResultSetExtractor<CheckoutAttempt>>any()))
                .thenAnswer(invocation -> {
                    ResultSetExtractor<CheckoutAttempt> extractor = invocation.getArgument(2);
                    return extractor.extractData(row);
                });
        when(jdbc.queryForObject(contains("fn_order_pricing"),
                org.mockito.ArgumentMatchers.<RowMapper<com.pliego.foundation.money.MonetaryAmounts>>any(), eq(700L)))
                .thenAnswer(invocation -> {
                    RowMapper<com.pliego.foundation.money.MonetaryAmounts> mapper = invocation.getArgument(1);
                    return mapper.mapRow(row, 0);
                });
        when(jdbc.queryForObject(contains("fn_order_offer_pricing"),
                org.mockito.ArgumentMatchers.<RowMapper<com.pliego.modules.sales.application.PostPurchaseModels.OfferPricing>>any(), eq(700L)))
                .thenAnswer(invocation -> {
                    RowMapper<com.pliego.modules.sales.application.PostPurchaseModels.OfferPricing> mapper = invocation.getArgument(1);
                    return mapper.mapRow(row, 0);
                });

        var order = new JdbcCheckoutGateway(new DatabaseExceptionTranslator(), jdbc, new ObjectMapper())
                .resolve(42L, UUID.randomUUID()).order();

        assertNotNull(order);
        assertTrue(order.offerPricing().pricingSnapshotAvailable());
        assertEquals(new BigDecimal("44.31"), order.offerPricing().originalSubtotal());
        assertEquals(new BigDecimal("4.51"), order.offerPricing().savingsTotal());
        assertEquals(new BigDecimal("39.80"), order.offerPricing().currentSubtotal());
        assertEquals(new BigDecimal("5.97"), order.amounts().taxAmount());
        assertEquals(new BigDecimal("45.77"), order.total());
        assertNull(order.fulfillment());
    }

    private static ResultSet orderRow() throws Exception {
        var row = mock(ResultSet.class);
        when(row.getLong("order_id")).thenReturn(700L);
        when(row.getString("order_state")).thenReturn("CONFIRMED");
        when(row.getString("purchase_state")).thenReturn("CONFIRMED");
        when(row.getObject("created_at", OffsetDateTime.class)).thenReturn(OffsetDateTime.parse("2026-09-23T19:30:00Z"));
        when(row.getObject("updated_at", OffsetDateTime.class)).thenReturn(OffsetDateTime.parse("2026-09-23T19:31:00Z"));
        when(row.getString("payment")).thenReturn("{}");
        when(row.getString("state_history")).thenReturn("[]");
        when(row.getString("credit_notes")).thenReturn("[]");
        when(row.getBoolean("pricing_snapshot_available")).thenReturn(true);
        for (var amount : Map.of("subtotal", "39.80", "tax_rate", "15.00", "tax_amount", "5.97",
                "shipping_amount", "0.00", "total", "45.77", "original_subtotal", "44.31",
                "savings_total", "4.51", "current_subtotal", "39.80").entrySet()) {
            when(row.getBigDecimal(amount.getKey())).thenReturn(new BigDecimal(amount.getValue()));
        }
        return row;
    }
}
