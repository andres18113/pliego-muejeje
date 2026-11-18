package com.pliego.modules.catalog.application;

import java.math.BigDecimal;

public record OfferLifecycleAdvance(String state, int transitionCount, BigDecimal maxLagSeconds) { }
