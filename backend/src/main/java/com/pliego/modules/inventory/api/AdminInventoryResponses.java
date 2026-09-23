package com.pliego.modules.inventory.api;

/** Wire representations for ADMIN inventory operations; identifiers remain strings. */
public final class AdminInventoryResponses {
    private AdminInventoryResponses() { }

    public record Item(String editionId, String bookId, String title, String sku, String isbn13,
            String editionState, int stockActual, int stockMinimum, boolean lowStock, String updatedAt) { }
    public record Movement(String movementId, String editionId, String orderId, String actorUserId, String type,
            int quantity, int stockBefore, int stockAfter, String reason, String eventAt) { }
    public record MovementCreated(String movementId, int stockBefore, int stockAfter) { }
}
