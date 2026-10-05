package com.pliego.modules.sales.gateway;
import java.util.List;
import com.pliego.modules.sales.application.PickupLocation;
public interface PickupLocationGateway {
    List<PickupLocation> activeLocations();
    void collect(long actorId, long orderId, String pickupCode);
}
