package com.pliego.modules.billing.application;

/** Replaceable private document storage port. PostgreSQL is the default; R2 is selected by PLIEGO_R2_ENABLED. */
public interface InvoiceDocumentStore {
    /** Prepare the bytes in the selected store before the transactional READY completion. */
    InvoiceStoredArtifact prepare(InvoiceJob job, byte[] content);
    InvoiceDownload download(long actorId, long orderId, String type);
    InvoiceDocumentAccessResult access(long actorId, long orderId, String type, String apiStreamUrl, String disposition);
}
