package com.pliego.modules.customer.application;

public record CustomerProfile(long customerId, String email, String firstNames, String lastNames, String phone,
        String state, long version, boolean emailVerified, java.time.Instant emailUndeliverableSince,
        com.pliego.modules.identity.application.PendingEmailChange pendingEmail) {
}
