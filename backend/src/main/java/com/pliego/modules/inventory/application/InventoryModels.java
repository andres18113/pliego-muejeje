package com.pliego.modules.inventory.application;

import java.util.List;

/** Application inputs and read models for ADMIN inventory operations. */
public final class InventoryModels {
    private InventoryModels() { }

    public record Search(Long editionId, String title, String sku, boolean lowStockOnly, int page, int pageSize) { }
    public record MovementSearch(long editionId, String type, int page, int pageSize) { }
    public record Page<T>(List<T> items, long totalCount) {
        public Page { items = List.copyOf(items); }
    }

    public record InventoryItem(String editionId, String bookId, String title, String sku, String isbn13,
            String editionState, int stockActual, int stockMinimum, boolean lowStock, String updatedAt) { }
    public record Movement(String movementId, String editionId, String orderId, String actorUserId, String type,
            int quantity, int stockBefore, int stockAfter, String reason, String eventAt) { }
    public record MovementResult(String movementId, int stockBefore, int stockAfter) { }

    public record Entry(int quantity, String reason) { }
    public record Adjustment(String type, int quantity, String reason) { }
}
