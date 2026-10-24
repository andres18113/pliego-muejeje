package com.pliego.modules.customer.gateway;

import com.pliego.modules.customer.application.BillingIdentity;

public interface BillingIdentityGateway {
    BillingIdentity find(long actorUserId);
    void register(long actorUserId, String type, String number);
    void correct(long actorUserId, String type, String expectedNumber, String number);
}
