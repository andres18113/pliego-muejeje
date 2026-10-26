package com.pliego.modules.sales.gateway;
import java.util.List;
import com.pliego.modules.sales.application.PickupLocationReference;
public interface PickupLocationGateway {
    List<PickupLocationReference> activeLocations();
    void collect(long actorId, long orderId, String pickupCode);
}
