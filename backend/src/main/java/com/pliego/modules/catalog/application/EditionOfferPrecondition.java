package com.pliego.modules.catalog.application;

import java.math.BigDecimal;

/** Optional create-only snapshot; PostgreSQL validates the complete precondition. */
public record EditionOfferPrecondition(String ifNoneMatch, BigDecimal expectedBasePrice, String expectedStock) { }
