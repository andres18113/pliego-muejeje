package com.pliego.modules.billing.application;

/** Private Database API result. Object keys never enter customer JSON or ordinary logs. */
public record InvoiceArtifactAccessGrant(long invoiceId, String provenance, String fileState, String storageKind,
        String objectKey, String checksum, Long sizeBytes, String mimeType, String fileName, String documentNumber) {
    @Override public String toString() {
        return "InvoiceArtifactAccessGrant[invoiceId=" + invoiceId + ", provenance=" + provenance + ", fileState="
                + fileState + ", storageKind=" + storageKind + ", objectKey=REDACTED, checksum=" + checksum
                + ", sizeBytes=" + sizeBytes + ", mimeType=" + mimeType + ", fileName=" + fileName + "]";
    }
}
