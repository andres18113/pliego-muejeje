package com.pliego.modules.identity.application;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class RegistrationAttemptScheduler {
    private static final Logger LOG = LoggerFactory.getLogger(RegistrationAttemptScheduler.class);
    private final RegistrationAttemptMaintenance maintenance;

    public RegistrationAttemptScheduler(RegistrationAttemptMaintenance maintenance) { this.maintenance = maintenance; }

    @Scheduled(fixedDelay = 60000, initialDelay = 60000)
    public void cleanup() {
        try { maintenance.cleanup(); }
        catch (RuntimeException exception) { LOG.warn("registration_attempt_cleanup state=FAILED code=DATABASE_ERROR"); }
        // Separate transactions: cleanup never retains one bucket class while acquiring another.
        try { maintenance.cleanupNeutralReceipts(); }
        catch (RuntimeException exception) { LOG.warn("registration_receipt_cleanup state=FAILED code=DATABASE_ERROR"); }
    }
}
