package com.pliego.modules.identity.application;

import java.time.OffsetDateTime;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import com.pliego.modules.identity.gateway.LoginAttemptAdmissionGateway;

@Service
public class LoginAttemptAdmissionService {
    private final LoginAttemptAdmissionGateway gateway;

    public LoginAttemptAdmissionService(LoginAttemptAdmissionGateway gateway) {
        this.gateway = gateway;
    }

    @Transactional(transactionManager = "loginAdmissionTransactionManager", propagation = Propagation.REQUIRES_NEW)
    public int admit(String email, String ipHash, OffsetDateTime pairBlockedUntil) {
        return gateway.admit(email, ipHash, pairBlockedUntil);
    }
}
