package com.pliego.modules.catalog.application;

import java.math.BigDecimal;
import java.time.Instant;

/** Internal operational projection; never exposed by the public refresh endpoint. */
public record OfferLifecycleStatus(Instant serverTime, Instant lastAttemptAt, Instant lastSuccessAt,
        Instant lastFailureAt, String lastFailureCode, int lastTransitionCount, BigDecimal lastMaxLagSeconds,
        long successCount, long failureCount, long transitionCount, long pendingCount,
        Instant oldestPendingAt, BigDecimal lagSeconds, Instant nextTransitionAt) { }
