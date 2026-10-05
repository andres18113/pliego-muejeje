package com.pliego.modules.sales.application;

import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.pliego.modules.sales.gateway.PickupLocationGateway;

@Service
public class PickupService {
    private final PickupLocationGateway gateway;
    public PickupService(PickupLocationGateway gateway) { this.gateway=gateway; }
    @Transactional(readOnly=true)
    public List<PickupLocation> locations() { return gateway.activeLocations(); }
    @Transactional
    public void collect(long actorId,long orderId,String code) { gateway.collect(actorId,orderId,code); }
}
