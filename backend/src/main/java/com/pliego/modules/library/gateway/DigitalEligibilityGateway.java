package com.pliego.modules.library.gateway;

import java.util.List;
import com.pliego.modules.library.application.DigitalEligibility;

public interface DigitalEligibilityGateway {
    List<DigitalEligibility> get(long actorId, List<Long> editionIds);
}
