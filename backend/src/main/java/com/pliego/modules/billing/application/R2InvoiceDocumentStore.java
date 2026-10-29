package com.pliego.modules.billing.application;

import java.security.MessageDigest;
import java.time.Clock;
import java.util.HexFormat;
import com.pliego.modules.billing.gateway.BillingGateway;

/** R2 adapter. Uploads are content-addressed and happen before the short PostgreSQL completion transaction. */
public final class R2InvoiceDocumentStore implements InvoiceDocumentStore {
    private final BillingGateway gateway;
    private final R2ObjectClient objects;
    private final R2PresignedUrlSigner signer;
    private final R2StorageProperties properties;
    private final Clock clock;

    public R2InvoiceDocumentStore(BillingGateway gateway, R2ObjectClient objects, R2PresignedUrlSigner signer,
            R2StorageProperties properties) {
        this(gateway, objects, signer, properties, Clock.systemUTC());
    }

    R2InvoiceDocumentStore(BillingGateway gateway, R2ObjectClient objects, R2PresignedUrlSigner signer,
            R2StorageProperties properties, Clock clock) {
        this.gateway = gateway; this.objects = objects; this.signer = signer; this.properties = properties; this.clock = clock;
    }

    @Override public InvoiceStoredArtifact prepare(InvoiceJob job, byte[] content) {
        try {
            String checksum = HexFormat.of().formatHex(sha256(content));
            String key = R2InvoiceObjectKey.forArtifact(properties.keyPrefix(), job.invoiceId(), checksum, job.type());
            String mime = mimeType(job.type());
            objects.putObject(key, content, mime);
            return InvoiceStoredArtifact.r2(key, checksum, content.length, mime);
        } catch (InvoiceDocumentUploadException uploadFailure) {
            throw uploadFailure;
        } catch (RuntimeException uploadFailure) {
            throw new InvoiceDocumentUploadException();
        }
    }

    @Override public InvoiceDownload download(long actorId, long orderId, String type) {
        InvoiceArtifactAccessGrant grant = gateway.access(actorId, orderId, type);
        if (grant == null || !"READY".equals(grant.fileState())) return null;
        if (databaseStored(grant)) return gateway.download(actorId, orderId, type);
        if (!"R2".equals(grant.storageKind())) throw new InvoiceDocumentUnavailableException();
        try {
            byte[] content = objects.getObject(grant.objectKey());
            verifyObject(grant, content);
            return new InvoiceDownload(content, grant.mimeType(), grant.fileName(), grant.checksum());
        } catch (InvoiceDocumentUnavailableException unavailable) {
            throw unavailable;
        } catch (RuntimeException failure) {
            throw new InvoiceDocumentUnavailableException();
        }
    }

    @Override public InvoiceDocumentAccessResult access(long actorId, long orderId, String type, String apiStreamUrl,
            String disposition) {
        InvoiceArtifactAccessGrant grant = gateway.access(actorId, orderId, type);
        if (grant == null) return null;
        if (!"READY".equals(grant.fileState()))
            return new InvoiceDocumentAccessResult(grant.provenance(), grant.fileState(), null);
        if (databaseStored(grant))
            return new InvoiceDocumentAccessResult(grant.provenance(), grant.fileState(),
                    new InvoiceDocumentAccess("API_STREAM", apiStreamUrl, null));
        if (!"R2".equals(grant.storageKind())) throw new InvoiceDocumentUnavailableException();
        if (!("inline".equals(disposition) || "attachment".equals(disposition)))
            throw new IllegalArgumentException("La presentación debe ser inline o attachment.");
        String documentNumber = grant.documentNumber();
        if (documentNumber == null || !documentNumber.matches("999-999-[0-9]{9}"))
            throw new InvoiceDocumentUnavailableException();
        String filename = "factura-" + documentNumber + ".pdf";
        try {
            var signed = signer.presignR2Get(properties, grant.objectKey(), "application/pdf",
                    disposition + "; filename=\"" + filename + "\"", clock.instant());
            return new InvoiceDocumentAccessResult(grant.provenance(), grant.fileState(),
                    new InvoiceDocumentAccess("SIGNED_URL", signed.url(), signed.expiresAt()));
        } catch (RuntimeException signingFailure) {
            throw new InvoiceDocumentUnavailableException();
        }
    }

    private static boolean databaseStored(InvoiceArtifactAccessGrant grant) {
        return grant.storageKind() == null || "DATABASE".equals(grant.storageKind());
    }

    private static void verifyObject(InvoiceArtifactAccessGrant grant, byte[] content) {
        if (content == null || grant.sizeBytes() == null || content.length != grant.sizeBytes()
                || grant.checksum() == null || !HexFormat.of().formatHex(sha256(content)).equals(grant.checksum()))
            throw new InvoiceDocumentUnavailableException();
    }

    private static String mimeType(String type) {
        return switch (type) { case "PDF" -> "application/pdf"; case "XML" -> "application/xml";
            default -> throw new IllegalArgumentException("Tipo de documento no admitido."); };
    }

    private static byte[] sha256(byte[] content) {
        try { return MessageDigest.getInstance("SHA-256").digest(content); }
        catch (java.security.NoSuchAlgorithmException impossible) { throw new IllegalStateException("SHA-256 no está disponible."); }
    }
}
