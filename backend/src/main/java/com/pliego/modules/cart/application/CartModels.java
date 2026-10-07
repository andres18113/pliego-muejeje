package com.pliego.modules.cart.application;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

/** Cart read and command results returned by PostgreSQL's Database API. */
public final class CartModels {

    private CartModels() { }

    public record Cart(String cartId, String state, List<CartItem> items, BigDecimal totalCurrent,
            com.pliego.foundation.money.MonetaryAmounts amounts, DeliveryWindow deliveryWindow,
            boolean requiresPhysicalFulfillment, int physicalItemCount, int digitalItemCount,
            BigDecimal originalSubtotal, BigDecimal savingsTotal, BigDecimal currentSubtotal, String quoteFingerprint) {
        public Cart(String cartId, String state, List<CartItem> items, BigDecimal totalCurrent,
                com.pliego.foundation.money.MonetaryAmounts amounts, DeliveryWindow deliveryWindow,
                boolean requiresPhysicalFulfillment, int physicalItemCount, int digitalItemCount,
                BigDecimal originalSubtotal, BigDecimal savingsTotal, BigDecimal currentSubtotal) {
            this(cartId,state,items,totalCurrent,amounts,deliveryWindow,requiresPhysicalFulfillment,physicalItemCount,digitalItemCount,originalSubtotal,savingsTotal,currentSubtotal,null);
        }
        public Cart(String cartId, String state, List<CartItem> items, BigDecimal totalCurrent,
                com.pliego.foundation.money.MonetaryAmounts amounts, DeliveryWindow deliveryWindow,
                boolean requiresPhysicalFulfillment, int physicalItemCount, int digitalItemCount) {
            this(cartId, state, items, totalCurrent, amounts, deliveryWindow,
                    requiresPhysicalFulfillment, physicalItemCount, digitalItemCount, null, null, null);
        }
        public Cart(String cartId, String state, List<CartItem> items, BigDecimal totalCurrent,
                com.pliego.foundation.money.MonetaryAmounts amounts, DeliveryWindow deliveryWindow) {
            this(cartId,state,items,totalCurrent,amounts,deliveryWindow,false,0,0);
        }
        public Cart(String cartId, String state, List<CartItem> items, BigDecimal totalCurrent,
                com.pliego.foundation.money.MonetaryAmounts amounts) {
            this(cartId,state,items,totalCurrent,amounts,null);
        }
        public Cart(String cartId, String state, List<CartItem> items, BigDecimal totalCurrent) {
            this(cartId,state,items,totalCurrent,new com.pliego.foundation.money.MonetaryAmounts(
                    totalCurrent,BigDecimal.ZERO,BigDecimal.ZERO,BigDecimal.ZERO,totalCurrent));
        }
    }

    /** Home-delivery window computed by the Database API in the store's calendar; absent when nothing ships. */
    public record DeliveryWindow(LocalDate from, LocalDate to) { }

    public record CartItem(String cartItemId, String editionId, String title, String authors, String sku,
            String coverUrl, int quantity, BigDecimal currentPrice, BigDecimal currentSubtotal,
            boolean available, String unavailabilityReason, String format, boolean requiresPhysicalFulfillment,
            boolean quantityEditable, BigDecimal originalPrice, BigDecimal unitSavings,
            BigDecimal originalSubtotal, BigDecimal lineSavings) {
        public CartItem(String cartItemId, String editionId, String title, String authors, String sku,
                String coverUrl, int quantity, BigDecimal currentPrice, BigDecimal currentSubtotal,
                boolean available, String unavailabilityReason, String format, boolean requiresPhysicalFulfillment,
                boolean quantityEditable) {
            this(cartItemId, editionId, title, authors, sku, coverUrl, quantity, currentPrice,
                    currentSubtotal, available, unavailabilityReason, format, requiresPhysicalFulfillment,
                    quantityEditable, null, null, null, null);
        }
    }

    public record CartItemResult(String cartId, String cartItemId, int quantity) { }
}
