package com.pliego.modules.customer.application;

import java.time.OffsetDateTime;

public record BillingIdentityCorrectionDecision(String id, String status, OffsetDateTime decidedAt,
        String decidedBy, String decisionReason) { }
