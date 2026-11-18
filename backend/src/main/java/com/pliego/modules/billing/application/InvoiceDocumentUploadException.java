package com.pliego.modules.billing.application;

/** Retryable upload failure. Provider details and credentials are deliberately omitted. */
public final class InvoiceDocumentUploadException extends RuntimeException {
    public InvoiceDocumentUploadException() { super("No se pudo cargar el documento privado."); }
}
