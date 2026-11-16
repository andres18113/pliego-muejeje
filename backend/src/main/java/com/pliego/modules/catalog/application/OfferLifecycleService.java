package com.pliego.modules.catalog.application;

import com.pliego.modules.catalog.gateway.OfferLifecycleGateway;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class OfferLifecycleService {
    private final OfferLifecycleGateway gateway;

    public OfferLifecycleService(OfferLifecycleGateway gateway) { this.gateway = gateway; }

    @Transactional(readOnly = true, timeout = 2)
    public OfferRefreshClock clock() { return gateway.clock(); }

    @Transactional(timeout = 2)
    public OfferLifecycleAdvance advance(int limit) { return gateway.advance(limit); }

    @Transactional(readOnly = true, timeout = 2)
    public OfferLifecycleStatus status() { return gateway.status(); }

    @Transactional(propagation = Propagation.REQUIRES_NEW, timeout = 2)
    public void failure(String code) { gateway.failure(code); }
}
