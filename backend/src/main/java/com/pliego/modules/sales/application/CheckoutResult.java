package com.pliego.modules.sales.application;

import java.math.BigDecimal;

public record CheckoutResult(String orderId, String orderState, String paymentState, BigDecimal total,
        String paymentReference, PostPurchaseModels.Fulfillment fulfillment,
        com.pliego.foundation.money.MonetaryAmounts amounts, PostPurchaseModels.OfferPricing offerPricing) {
    public CheckoutResult(String orderId, String orderState, String paymentState, BigDecimal total,
            String paymentReference, PostPurchaseModels.Fulfillment fulfillment,
            com.pliego.foundation.money.MonetaryAmounts amounts) {
        this(orderId, orderState, paymentState, total, paymentReference, fulfillment, amounts,
                PostPurchaseModels.OfferPricing.unavailable());
    }
    public CheckoutResult(String orderId, String orderState, String paymentState, BigDecimal total, String paymentReference) {
        this(orderId, orderState, paymentState, total, paymentReference, null,
                new com.pliego.foundation.money.MonetaryAmounts(total,BigDecimal.ZERO,BigDecimal.ZERO,BigDecimal.ZERO,total));
    }
}
