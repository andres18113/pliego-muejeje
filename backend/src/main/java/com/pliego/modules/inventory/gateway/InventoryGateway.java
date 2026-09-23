package com.pliego.modules.inventory.gateway;

import com.pliego.modules.inventory.application.InventoryModels.Adjustment;
import com.pliego.modules.inventory.application.InventoryModels.Entry;
import com.pliego.modules.inventory.application.InventoryModels.InventoryItem;
import com.pliego.modules.inventory.application.InventoryModels.Movement;
import com.pliego.modules.inventory.application.InventoryModels.MovementResult;
import com.pliego.modules.inventory.application.InventoryModels.MovementSearch;
import com.pliego.modules.inventory.application.InventoryModels.Page;
import com.pliego.modules.inventory.application.InventoryModels.Search;

/** ADMIN inventory operations through the approved PostgreSQL Database API. */
public interface InventoryGateway {
    Page<InventoryItem> search(long actorId, Search query);
    Page<Movement> movements(long actorId, MovementSearch query);
    MovementResult entry(long actorId, long editionId, Entry request);
    MovementResult adjust(long actorId, long editionId, Adjustment request);
    void setMinimum(long actorId, long editionId, int stockMinimum);
}
