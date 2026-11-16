package com.pliego.modules.identity.application;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class LoginAttemptScheduler {
    private static final Logger LOG = LoggerFactory.getLogger(LoginAttemptScheduler.class);
    private final LoginAttemptMaintenance maintenance;
    public LoginAttemptScheduler(LoginAttemptMaintenance maintenance) { this.maintenance = maintenance; }

    @Scheduled(fixedDelay = 60000, initialDelay = 60000)
    public void cleanup() {
        try {
            maintenance.cleanup();
        } catch (RuntimeException exception) {
            LOG.warn("login_attempt_cleanup state=FAILED code=DATABASE_ERROR");
        }
    }

    @Configuration
    @EnableScheduling
    static class Scheduling { }
}
