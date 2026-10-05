package com.pliego.modules.sales.application;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.pliego.modules.sales.gateway.CheckoutGateway;
import java.util.UUID;

/** One Spring transaction and one approved business Procedure per checkout. */
@Service
public class CheckoutService {

    private final CheckoutGateway gateway;

    public CheckoutService(CheckoutGateway gateway) {
        this.gateway = gateway;
    }

    @Transactional
    public CheckoutResult checkout(long actorUserId, UUID key, Long addressId, String paymentMethod, String paymentOutcome,
            Long cartId, String fulfillmentMethod, Long pickupLocationId) {
        return gateway.checkout(actorUserId, key, addressId, paymentMethod, paymentOutcome, cartId, fulfillmentMethod, pickupLocationId);
    }

    // Resolution writes a terminal fence if execution never reached PostgreSQL.
    @Transactional
    public CheckoutAttempt resolve(long actorUserId, UUID key) {
        return gateway.resolve(actorUserId, key);
    }
}
