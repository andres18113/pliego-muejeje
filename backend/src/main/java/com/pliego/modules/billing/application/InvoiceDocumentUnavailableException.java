package com.pliego.modules.billing.application;

/** A stored private object could not be read or verified. Provider details are deliberately omitted. */
public final class InvoiceDocumentUnavailableException extends RuntimeException {
    public InvoiceDocumentUnavailableException() { super("No está disponible el documento privado."); }
}
