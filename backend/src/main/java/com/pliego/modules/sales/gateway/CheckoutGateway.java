package com.pliego.modules.sales.gateway;

import com.pliego.modules.sales.application.CheckoutResult;

public interface CheckoutGateway {
    CheckoutResult checkout(long actorUserId, long addressId, String paymentMethod, String paymentOutcome);
}
