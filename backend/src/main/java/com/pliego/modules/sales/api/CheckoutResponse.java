package com.pliego.modules.sales.api;

public record CheckoutResponse(String orderId, String orderState, String paymentState, String total,
        String paymentReference) { }
