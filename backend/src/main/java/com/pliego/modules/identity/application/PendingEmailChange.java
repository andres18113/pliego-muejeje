package com.pliego.modules.identity.application;

import java.time.Instant;

public record PendingEmailChange(String address, Instant expiresAt, String delivery) {}
