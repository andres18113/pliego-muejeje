package com.pliego.modules.identity.application;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.pliego.modules.identity.gateway.LoginAttemptGateway;

@Service
public class LoginAttemptMaintenance {
    private final LoginAttemptGateway gateway;
    public LoginAttemptMaintenance(LoginAttemptGateway gateway) { this.gateway = gateway; }

    @Transactional
    public int cleanup() { return gateway.cleanup(); }
}
