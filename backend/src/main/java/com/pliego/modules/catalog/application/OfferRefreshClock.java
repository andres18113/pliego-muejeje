package com.pliego.modules.catalog.application;

import java.time.Instant;

/** Timing hints only. PostgreSQL remains authoritative for every offer projection. */
public record OfferRefreshClock(Instant serverTime, Instant nextTransitionAt, int revalidateAfterSeconds) { }
