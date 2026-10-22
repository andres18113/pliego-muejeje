package com.pliego.modules.customer.application;

import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.pliego.foundation.security.CurrentPasswordMismatchException;
import com.pliego.modules.customer.gateway.BillingIdentityGateway;
import com.pliego.modules.customer.gateway.CustomerGateway;
import com.pliego.foundation.validation.EcuadorianIdentification;

@Service
public class BillingIdentityService {
    private final BillingIdentityGateway gateway;
    private final CustomerGateway customers;
    private final PasswordEncoder passwordEncoder;
    public BillingIdentityService(BillingIdentityGateway gateway, CustomerGateway customers, PasswordEncoder passwordEncoder) {
        this.gateway = gateway;
        this.customers = customers;
        this.passwordEncoder = passwordEncoder;
    }
    @Transactional(readOnly = true)
    public BillingIdentity find(long actorUserId) { return gateway.find(actorUserId); }
    @Transactional
    public void register(long actorUserId, String type, String number) {
        gateway.register(actorUserId, type, EcuadorianIdentification.normalized(number));
    }
    /** Format validation cannot prove ownership, so a correction re-authenticates like an email change. */
    @Transactional
    public void correct(long actorUserId, String type, String currentNumber, String number, String currentPassword) {
        String passwordHash = customers.passwordHash(actorUserId);
        if (passwordHash == null || !passwordEncoder.matches(currentPassword, passwordHash)) {
            throw new CurrentPasswordMismatchException();
        }
        gateway.correct(actorUserId, type, EcuadorianIdentification.normalized(currentNumber), EcuadorianIdentification.normalized(number));
    }
}
