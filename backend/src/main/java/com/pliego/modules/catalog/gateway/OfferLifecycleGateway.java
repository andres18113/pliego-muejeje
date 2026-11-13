package com.pliego.modules.catalog.gateway;

import com.pliego.modules.catalog.application.OfferLifecycleAdvance;
import com.pliego.modules.catalog.application.OfferLifecycleStatus;
import com.pliego.modules.catalog.application.OfferRefreshClock;

public interface OfferLifecycleGateway {
    OfferRefreshClock clock();
    OfferLifecycleAdvance advance(int limit);
    OfferLifecycleStatus status();
    void failure(String code);
}
