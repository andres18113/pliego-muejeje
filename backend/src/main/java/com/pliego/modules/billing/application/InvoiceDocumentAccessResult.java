package com.pliego.modules.billing.application;

/** Authorized file state plus an optional delivery instruction when the file is READY. */
public record InvoiceDocumentAccessResult(String provenance, String fileState, InvoiceDocumentAccess access) { }
