package com.pliego.modules.sales.application;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.pliego.modules.sales.gateway.HomeDeliveryGateway;

@Service
public class HomeDeliveryService {
    private final HomeDeliveryGateway gateway;

    public HomeDeliveryService(HomeDeliveryGateway gateway) {
        this.gateway = gateway;
    }

    @Transactional
    public void advanceDue(int batchSize) {
        gateway.advanceDue(batchSize);
    }
}
