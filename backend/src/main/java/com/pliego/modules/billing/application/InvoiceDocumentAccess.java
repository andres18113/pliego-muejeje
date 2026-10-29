package com.pliego.modules.billing.application;

import java.time.Instant;

/** A short-lived delivery instruction; object keys and provider credentials stay inside the storage adapter. */
public record InvoiceDocumentAccess(String delivery, String url, Instant expiresAt) { }
