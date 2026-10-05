package com.pliego.modules.customer.application;

/**
 * Published after a CUSTOMER's sign-in email changes (only when it actually changed). It is the
 * in-process integration event. Transactional email verification is already persisted in the
 * PostgreSQL outbox by the same business transaction (ADR 0020). Do not use an AFTER_COMMIT listener
 * to replace that durable delivery guarantee. No event listener exists yet.
 */
public record CustomerEmailChanged(long userId, String previousEmail, String newEmail) {
}
