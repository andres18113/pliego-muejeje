package com.pliego.modules.sales.application;

import java.math.BigDecimal;

public record CheckoutResult(String orderId, String orderState, String paymentState, BigDecimal total,
        String paymentReference) { }
