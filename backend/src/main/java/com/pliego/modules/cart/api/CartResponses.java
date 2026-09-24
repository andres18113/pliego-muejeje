package com.pliego.modules.cart.api;

import java.util.List;

/** REST representations for customer cart reads and mutations. */
public final class CartResponses {

    private CartResponses() { }

    public record Cart(String cartId, String state, List<Item> items, String totalCurrent) { }

    public record Item(String cartItemId, String editionId, String title, String authors, String sku,
            String coverUrl, int quantity, String currentPrice, String currentSubtotal, boolean available,
            String unavailabilityReason) { }

    public record ItemMutation(String cartId, String cartItemId, int quantity) { }
}
