package com.pliego.modules.billing.application;

/** Result of preparing one artifact before the fenced PostgreSQL READY command. */
public record InvoiceStoredArtifact(String storageKind, String objectKey, String checksum, long sizeBytes,
        String mimeType, byte[] content) {
    public InvoiceStoredArtifact {
        content = content == null ? null : content.clone();
    }

    public static InvoiceStoredArtifact database(byte[] bytes, String checksum, String mimeType) {
        return new InvoiceStoredArtifact("DATABASE", null, checksum, bytes.length, mimeType, bytes);
    }

    public static InvoiceStoredArtifact r2(String objectKey, String checksum, long sizeBytes, String mimeType) {
        return new InvoiceStoredArtifact("R2", objectKey, checksum, sizeBytes, mimeType, null);
    }

    @Override public byte[] content() { return content == null ? null : content.clone(); }

    @Override public String toString() {
        return "InvoiceStoredArtifact[storageKind=" + storageKind + ", objectKey=REDACTED, checksum="
                + checksum + ", sizeBytes=" + sizeBytes + ", mimeType=" + mimeType + ", content=REDACTED]";
    }
}
