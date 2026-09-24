package com.pliego.modules.cart.application;

import java.math.BigDecimal;
import java.util.List;

/** Cart read and command results returned by PostgreSQL's Database API. */
public final class CartModels {

    private CartModels() { }

    public record Cart(String cartId, String state, List<CartItem> items, BigDecimal totalCurrent) { }

    public record CartItem(String cartItemId, String editionId, String title, String authors, String sku,
            String coverUrl, int quantity, BigDecimal currentPrice, BigDecimal currentSubtotal,
            boolean available, String unavailabilityReason) { }

    public record CartItemResult(String cartId, String cartItemId, int quantity) { }
}
