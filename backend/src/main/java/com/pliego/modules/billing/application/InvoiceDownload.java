package com.pliego.modules.billing.application;

public record InvoiceDownload(byte[] content, String mimeType, String fileName, String checksum) {
    public InvoiceDownload { content = content.clone(); }
    @Override public byte[] content() { return content.clone(); }
    @Override public String toString() { return "InvoiceDownload[content=REDACTED]"; }
}
