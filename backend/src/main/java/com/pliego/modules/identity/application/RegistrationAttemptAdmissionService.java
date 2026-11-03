package com.pliego.modules.identity.application;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import com.pliego.modules.identity.gateway.RegistrationAttemptGateway;

@Service
public class RegistrationAttemptAdmissionService {
    private final RegistrationAttemptGateway gateway;

    public RegistrationAttemptAdmissionService(RegistrationAttemptGateway gateway) { this.gateway = gateway; }

    @Transactional(transactionManager = "loginAdmissionTransactionManager", propagation = Propagation.REQUIRES_NEW)
    public int admit(String email, String ipHash) { return gateway.admit(email, ipHash); }
}
