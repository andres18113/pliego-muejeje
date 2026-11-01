package com.pliego.modules.sales.application;

import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.pliego.modules.sales.gateway.PickupLocationGateway;

@Service
public class PickupService {
    private final PickupLocationGateway gateway;
    public PickupService(PickupLocationGateway gateway) { this.gateway = gateway; }

    @Transactional(readOnly = true)
    public List<PickupLocationReference> locations() { return gateway.activeLocations(); }

    @Transactional
    public PickupModels.View collect(long actorId, long orderId, String code, boolean identityVerified) {
        gateway.collect(actorId, orderId, code, identityVerified);
        return gateway.detail(actorId, orderId);
    }

    @Transactional
    public PickupModels.Detail detail(long actorId, long orderId) { return gateway.handoverDetail(actorId, orderId); }

    @Transactional(readOnly = true)
    public PickupModels.Detail verifyCode(long actorId, long orderId, String code) { return gateway.verifyCode(actorId, orderId, code); }

    @Transactional
    public PickupModels.View lookup(long actorId, String code) { return gateway.lookup(actorId, code); }

    @Transactional
    public PickupModels.Page search(long actorId, PickupModels.Search search) { return gateway.search(actorId, search); }
}
