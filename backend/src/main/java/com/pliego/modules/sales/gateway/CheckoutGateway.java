package com.pliego.modules.sales.gateway;

import com.pliego.modules.sales.application.CheckoutResult;
import com.pliego.modules.sales.application.CheckoutAttempt;
import java.util.UUID;

public interface CheckoutGateway {
    CheckoutResult checkout(long actorUserId, UUID key, Long addressId, String paymentMethod, String paymentOutcome,
            Long cartId, String fulfillmentMethod, Long pickupLocationId);
    CheckoutAttempt resolve(long actorUserId, UUID key);
    CheckoutResult checkout(long actorUserId, UUID key, Long addressId, String paymentMethod, String paymentOutcome,
            Long cartId, String fulfillmentMethod, Long pickupLocationId, String quoteFingerprint);
}
