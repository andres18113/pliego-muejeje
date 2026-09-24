package com.pliego.modules.cart.application;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.pliego.modules.cart.application.CartModels.Cart;
import com.pliego.modules.cart.application.CartModels.CartItemResult;
import com.pliego.modules.cart.gateway.CartGateway;

/** Coordinates CUSTOMER cart commands; PostgreSQL owns cart state and availability. */
@Service
public class CartService {

    private final CartGateway gateway;

    public CartService(CartGateway gateway) {
        this.gateway = gateway;
    }

    @Transactional(readOnly = true)
    public Cart get(long actorId) {
        return gateway.get(actorId);
    }

    @Transactional
    public CartItemResult addItem(long actorId, long editionId, int quantity) {
        return gateway.addItem(actorId, editionId, quantity);
    }

    @Transactional
    public CartItemResult updateItem(long actorId, long cartItemId, int quantity) {
        return gateway.updateItem(actorId, cartItemId, quantity);
    }

    @Transactional
    public void removeItem(long actorId, long cartItemId) {
        gateway.removeItem(actorId, cartItemId);
    }
}
