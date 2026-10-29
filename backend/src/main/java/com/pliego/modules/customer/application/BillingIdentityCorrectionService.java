package com.pliego.modules.customer.application;

import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.pliego.modules.customer.gateway.BillingIdentityCorrectionGateway;

/** Transactional application boundary for one correction-request Database API routine per command. */
@Service
public class BillingIdentityCorrectionService {
    private final BillingIdentityCorrectionGateway gateway;

    public BillingIdentityCorrectionService(BillingIdentityCorrectionGateway gateway) { this.gateway = gateway; }

    @Transactional
    public BillingIdentityCorrection submit(long actorUserId, UUID key, String currentNumber, String proposedType,
            String proposedNumber, String reasonCode, String note) {
        return gateway.submit(actorUserId, key, currentNumber, proposedType, proposedNumber, reasonCode, note);
    }

    @Transactional
    public void withdraw(long actorUserId, long requestId) { gateway.withdraw(actorUserId, requestId); }

    @Transactional(readOnly = true)
    public BillingIdentityCorrectionPage search(long actorUserId, String status, int page, int pageSize) {
        return gateway.search(actorUserId, status, page, pageSize);
    }

    @Transactional
    public BillingIdentityCorrectionDecision decide(long actorUserId, long requestId, String decision,
            String decisionReason) {
        return gateway.decide(actorUserId, requestId, decision, decisionReason);
    }
}
