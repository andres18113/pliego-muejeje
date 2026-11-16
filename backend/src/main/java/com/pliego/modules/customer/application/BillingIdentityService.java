package com.pliego.modules.customer.application;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.pliego.modules.customer.gateway.BillingIdentityGateway;
import com.pliego.foundation.validation.EcuadorianIdentification;

@Service
public class BillingIdentityService {
    private final BillingIdentityGateway gateway;
    public BillingIdentityService(BillingIdentityGateway gateway) {
        this.gateway = gateway;
    }
    @Transactional(readOnly = true)
    public BillingIdentity find(long actorUserId) { return gateway.find(actorUserId); }
    @Transactional
    public void register(long actorUserId, String type, String number) {
        gateway.register(actorUserId, type, EcuadorianIdentification.normalized(number));
    }
    /**
     * PostgreSQL applies the invoice-use tiers and compare-and-set. Correction never requires a current password;
     * the optional legacy {@code currentPassword} JSON field is ignored by the API and is not passed to this service.
     */
    @Transactional
    public void correct(long actorUserId, String type, String currentNumber, String number) {
        gateway.correct(actorUserId, type, EcuadorianIdentification.normalized(currentNumber), EcuadorianIdentification.normalized(number));
    }
}
