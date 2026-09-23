package com.pliego.modules.inventory.application;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.pliego.modules.inventory.application.InventoryModels.Adjustment;
import com.pliego.modules.inventory.application.InventoryModels.Entry;
import com.pliego.modules.inventory.application.InventoryModels.InventoryItem;
import com.pliego.modules.inventory.application.InventoryModels.Movement;
import com.pliego.modules.inventory.application.InventoryModels.MovementResult;
import com.pliego.modules.inventory.application.InventoryModels.MovementSearch;
import com.pliego.modules.inventory.application.InventoryModels.Page;
import com.pliego.modules.inventory.application.InventoryModels.Search;
import com.pliego.modules.inventory.gateway.InventoryGateway;

/** Coordinates ADMIN inventory requests; PostgreSQL owns all stock invariants and results. */
@Service
public class InventoryService {

    private final InventoryGateway gateway;

    public InventoryService(InventoryGateway gateway) {
        this.gateway = gateway;
    }

    @Transactional(readOnly = true)
    public Page<InventoryItem> search(long actorId, Search query) {
        return gateway.search(actorId, query);
    }

    @Transactional(readOnly = true)
    public Page<Movement> movements(long actorId, MovementSearch query) {
        return gateway.movements(actorId, query);
    }

    @Transactional
    public MovementResult entry(long actorId, long editionId, Entry request) {
        return gateway.entry(actorId, editionId, request);
    }

    @Transactional
    public MovementResult adjust(long actorId, long editionId, Adjustment request) {
        return gateway.adjust(actorId, editionId, request);
    }

    @Transactional
    public void setMinimum(long actorId, long editionId, int stockMinimum) {
        gateway.setMinimum(actorId, editionId, stockMinimum);
    }
}
