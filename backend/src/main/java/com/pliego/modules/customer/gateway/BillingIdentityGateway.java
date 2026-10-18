package com.pliego.modules.customer.gateway;

import com.pliego.modules.customer.application.BillingIdentity;

public interface BillingIdentityGateway {
    BillingIdentity find(long actorUserId);
    void set(long actorUserId, String type, String number);
    void remove(long actorUserId);
}
