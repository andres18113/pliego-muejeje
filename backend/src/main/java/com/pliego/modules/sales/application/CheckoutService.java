package com.pliego.modules.sales.application;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.pliego.modules.sales.gateway.CheckoutGateway;

/** One Spring transaction and one approved business Procedure per checkout. */
@Service
public class CheckoutService {

    private final CheckoutGateway gateway;

    public CheckoutService(CheckoutGateway gateway) {
        this.gateway = gateway;
    }

    @Transactional
    public CheckoutResult checkout(long actorUserId, long addressId, String paymentMethod, String paymentOutcome) {
        return gateway.checkout(actorUserId, addressId, paymentMethod, paymentOutcome);
    }
}
