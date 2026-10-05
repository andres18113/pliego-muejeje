package com.pliego.modules.sales.application;

import java.math.BigDecimal;

public record CheckoutResult(String orderId, String orderState, String paymentState, BigDecimal total,
        String paymentReference, PostPurchaseModels.Fulfillment fulfillment, com.pliego.foundation.money.MonetaryAmounts amounts) {
    public CheckoutResult(String orderId, String orderState, String paymentState, BigDecimal total, String paymentReference) {
        this(orderId, orderState, paymentState, total, paymentReference, null,
                new com.pliego.foundation.money.MonetaryAmounts(total,BigDecimal.ZERO,BigDecimal.ZERO,BigDecimal.ZERO,total));
    }
}
