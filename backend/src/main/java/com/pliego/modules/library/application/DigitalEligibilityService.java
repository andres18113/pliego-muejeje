package com.pliego.modules.library.application;

import java.util.List;
import com.pliego.modules.library.gateway.DigitalEligibilityGateway;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional(readOnly = true)
public class DigitalEligibilityService {
    private final DigitalEligibilityGateway gateway;

    public DigitalEligibilityService(DigitalEligibilityGateway gateway) {
        this.gateway = gateway;
    }

    public List<DigitalEligibility> get(long actorId, List<Long> editionIds) {
        return gateway.get(actorId, editionIds);
    }
}
