package com.pliego.modules.sales.gateway;

import java.util.List;
import com.pliego.modules.sales.application.PickupLocationReference;
import com.pliego.modules.sales.application.PickupModels;

public interface PickupLocationGateway {
    List<PickupLocationReference> activeLocations();
    void collect(long actorId, long orderId, String pickupCode, boolean identityVerified);
    PickupModels.View detail(long actorId, long orderId);
    PickupModels.Detail handoverDetail(long actorId, long orderId);
    PickupModels.Detail verifyCode(long actorId, long orderId, String code);
    PickupModels.View lookup(long actorId, String code);
    PickupModels.Page search(long actorId, PickupModels.Search search);
}
