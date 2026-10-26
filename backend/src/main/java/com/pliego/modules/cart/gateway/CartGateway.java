package com.pliego.modules.cart.gateway;

import com.pliego.modules.cart.application.CartModels.Cart;
import com.pliego.modules.cart.application.CartModels.CartItemResult;
import com.pliego.modules.cart.application.CartModels.SavedForLaterList;

/** JDBC boundary for the approved PostgreSQL cart Function and Procedures. */
public interface CartGateway {

    Cart get(long actorId);

    CartItemResult addItem(long actorId, long editionId, int quantity);

    CartItemResult updateItem(long actorId, long cartItemId, int quantity);

    void removeItem(long actorId, long cartItemId);

    SavedForLaterList getSavedForLater(long actorId);

    void saveForLater(long actorId, long cartItemId);

    void moveSavedToCart(long actorId, long savedItemId);

    void removeSavedItem(long actorId, long savedItemId);
}
