package com.pliego.modules.billing.application;

import com.pliego.modules.billing.gateway.BillingGateway;

/** The private bytea store. All authorization and state checks stay in PostgreSQL. */
public final class DatabaseInvoiceDocumentStore implements InvoiceDocumentStore {
    private final BillingGateway gateway;

    public DatabaseInvoiceDocumentStore(BillingGateway gateway) { this.gateway = gateway; }

    @Override public InvoiceStoredArtifact prepare(InvoiceJob job, byte[] content) {
        String checksum = java.util.HexFormat.of().formatHex(sha256(content));
        String mime = "PDF".equals(job.type()) ? "application/pdf" : "application/xml";
        return InvoiceStoredArtifact.database(content, checksum, mime);
    }

    @Override public InvoiceDownload download(long actorId, long orderId, String type) {
        InvoiceArtifactAccessGrant grant = gateway.access(actorId, orderId, type);
        if (grant == null || !"READY".equals(grant.fileState())) return null;
        if ("R2".equals(grant.storageKind())) throw new InvoiceDocumentUnavailableException();
        return gateway.download(actorId, orderId, type);
    }

    @Override public InvoiceDocumentAccessResult access(long actorId, long orderId, String type, String apiStreamUrl,
            String disposition) {
        InvoiceArtifactAccessGrant grant = gateway.access(actorId, orderId, type);
        if (grant == null) return null;
        InvoiceDocumentAccess instruction = "READY".equals(grant.fileState())
                && (grant.storageKind() == null || "DATABASE".equals(grant.storageKind()))
                ? new InvoiceDocumentAccess("API_STREAM", apiStreamUrl, null) : null;
        return new InvoiceDocumentAccessResult(grant.provenance(), grant.fileState(), instruction);
    }

    private static byte[] sha256(byte[] content) {
        try { return java.security.MessageDigest.getInstance("SHA-256").digest(content); }
        catch (java.security.NoSuchAlgorithmException impossible) { throw new IllegalStateException("SHA-256 no está disponible."); }
    }
}
