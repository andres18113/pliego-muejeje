package com.pliego.modules.customer.application;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.pliego.modules.customer.gateway.BillingIdentityGateway;
import com.pliego.foundation.validation.EcuadorianCedula;

@Service
public class BillingIdentityService {
    private final BillingIdentityGateway gateway;
    public BillingIdentityService(BillingIdentityGateway gateway) { this.gateway = gateway; }
    @Transactional(readOnly = true)
    public BillingIdentity find(long actorUserId) { return gateway.find(actorUserId); }
    @Transactional
    public void set(long actorUserId, String type, String number) {
        gateway.set(actorUserId, type, EcuadorianCedula.normalized(number));
    }
    @Transactional
    public void remove(long actorUserId) { gateway.remove(actorUserId); }
}
