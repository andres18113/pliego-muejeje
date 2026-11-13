package com.pliego.modules.identity.application;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.pliego.modules.identity.gateway.RegistrationAttemptGateway;

@Service
public class RegistrationAttemptMaintenance {
    private final RegistrationAttemptGateway gateway;

    public RegistrationAttemptMaintenance(RegistrationAttemptGateway gateway) { this.gateway = gateway; }

    @Transactional
    public int cleanup() { return gateway.cleanup(); }

    @Transactional
    public int cleanupNeutralReceipts() { return gateway.cleanupNeutralReceipts(); }
}
