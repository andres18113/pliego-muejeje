package com.pliego.modules.catalog.application;

import java.math.BigDecimal;
import java.time.OffsetDateTime;

public record EditionOfferCommand(BigDecimal offerPrice, OffsetDateTime startsAt, OffsetDateTime endsAt, String offerCopy, String terms) { }
