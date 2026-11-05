package com.pliego.modules.identity.application;

import java.time.Instant;

/** A pending address change; the current login email is deliberately preserved. */
public record EmailChangeResult(String email, String address, Instant expiresAt) {}
