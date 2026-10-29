package com.pliego.modules.customer.gateway;

import java.util.UUID;

import com.pliego.modules.customer.application.AdminBillingIdentityCorrection;
import com.pliego.modules.customer.application.BillingIdentityCorrection;
import com.pliego.modules.customer.application.BillingIdentityCorrectionDecision;
import com.pliego.modules.customer.application.BillingIdentityCorrectionPage;

/** PostgreSQL Database API boundary for customer/admin correction-request commands and projections. */
public interface BillingIdentityCorrectionGateway {
    BillingIdentityCorrection submit(long actorUserId, UUID idempotencyKey, String currentNumber,
            String proposedType, String proposedNumber, String reasonCode, String note);
    void withdraw(long actorUserId, long requestId);
    BillingIdentityCorrectionPage search(long actorUserId, String status, int page, int pageSize);
    BillingIdentityCorrectionDecision decide(long actorUserId, long requestId, String decision, String decisionReason);
}
