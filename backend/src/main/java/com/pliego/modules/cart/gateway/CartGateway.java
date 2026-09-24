package com.pliego.modules.cart.gateway;

import com.pliego.modules.cart.application.CartModels.Cart;
import com.pliego.modules.cart.application.CartModels.CartItemResult;

/** JDBC boundary for the approved PostgreSQL cart Function and Procedures. */
public interface CartGateway {

    Cart get(long actorId);

    CartItemResult addItem(long actorId, long editionId, int quantity);

    CartItemResult updateItem(long actorId, long cartItemId, int quantity);

    void removeItem(long actorId, long cartItemId);
}
