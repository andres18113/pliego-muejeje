package com.pliego.modules.catalog.application;

import java.math.BigDecimal;
import java.time.Instant;

public record CatalogOffer(String offerId, BigDecimal originalPrice, BigDecimal discountAmount,
        Instant startsAt, Instant endsAt, int daysRemaining, boolean endingSoon, String offerCopy, String terms, BigDecimal effectivePrice, BigDecimal savingsPercent) { }
