package com.pliego.modules.billing.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.*;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import com.pliego.modules.billing.gateway.BillingGateway;

class R2InvoiceDocumentStoreTest {
    private final BillingGateway gateway = mock(BillingGateway.class);
    private final R2ObjectClient objects = mock(R2ObjectClient.class);
    private final R2StorageProperties properties = new R2StorageProperties(true, "billing-pliego",
            "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com", "auto",
            "fictional-access", "fictional-secret", "300", "invoices/");
    private final R2PresignedUrlSigner signer = new R2PresignedUrlSigner();
    private final R2InvoiceDocumentStore store = new R2InvoiceDocumentStore(gateway, objects, signer, properties,
            Clock.fixed(Instant.parse("2026-10-27T12:00:00Z"), ZoneOffset.UTC));
    private final InvoiceJob job = new InvoiceJob(42L, "PDF", UUID.randomUUID(), 1, "{}");

    @Test
    void prepare_uploadsContentAddressedPdfBeforeDatabaseCompletion() throws Exception {
        byte[] bytes = "%PDF-1.7".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        var stored = store.prepare(job, bytes);
        String expectedChecksum = java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(bytes));
        assertThat(stored.storageKind()).isEqualTo("R2");
        assertThat(stored.objectKey()).isEqualTo("invoices/42/" + expectedChecksum + ".pdf");
        assertThat(stored.sizeBytes()).isEqualTo(bytes.length);
        assertThat(stored.mimeType()).isEqualTo("application/pdf");
        verify(objects).putObject(stored.objectKey(), bytes, "application/pdf");
        verifyNoInteractions(gateway);
    }

    @Test
    void prepare_wrapsPutFailureAsRetryableUploadFailure() {
        doThrow(new IllegalStateException("private transport detail")).when(objects).putObject(anyString(), any(), anyString());
        assertThatThrownBy(() -> store.prepare(job, new byte[]{1}))
                .isInstanceOf(InvoiceDocumentUploadException.class)
                .hasMessage("No se pudo cargar el documento privado.")
                .hasMessageNotContaining("private transport detail");
        verifyNoInteractions(gateway);
    }

    @Test
    void download_streamsR2BytesAndVerifiesDatabaseChecksumAndSize() throws Exception {
        byte[] content = "%PDF-r2".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        String checksum = java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(content));
        when(gateway.access(7, 9, "PDF")).thenReturn(grant("R2", "READY", "invoices/42/" + checksum + ".pdf", checksum, content.length));
        when(objects.getObject("invoices/42/" + checksum + ".pdf")).thenReturn(content);
        var download = store.download(7, 9, "PDF");
        assertThat(download.content()).containsExactly(content);
        assertThat(download.mimeType()).isEqualTo("application/pdf");
        assertThat(download.fileName()).isEqualTo("pliego-factura-academica-999-999-000000042.pdf");
        assertThat(download.checksum()).isEqualTo(checksum);
    }

    @Test
    void download_keepsXmlAndExistingByteaArtifactsAvailableWhenR2IsActive() throws Exception {
        byte[] xmlBytes = "<factura/>".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        String xmlChecksum = java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(xmlBytes));
        String xmlKey = "invoices/42/" + xmlChecksum + ".xml";
        when(gateway.access(7, 9, "XML")).thenReturn(new InvoiceArtifactAccessGrant(42, "SIMULATED", "READY", "R2",
                xmlKey, xmlChecksum, (long) xmlBytes.length, "application/xml",
                "pliego-factura-academica-999-999-000000042.xml", "999-999-000000042"));
        when(objects.getObject(xmlKey)).thenReturn(xmlBytes);
        var xml = store.download(7, 9, "XML");
        assertThat(xml.mimeType()).isEqualTo("application/xml");
        assertThat(xml.content()).containsExactly(xmlBytes);

        var bytea = new InvoiceDownload(new byte[]{3, 4}, "application/pdf", "pliego-factura-academica-legacy.pdf", "legacy-hash");
        when(gateway.access(7, 10, "PDF")).thenReturn(new InvoiceArtifactAccessGrant(43, "SIMULATED", "READY", "DATABASE",
                null, "legacy-hash", 2L, "application/pdf", bytea.fileName(), "legacy-number"));
        when(gateway.download(7, 10, "PDF")).thenReturn(bytea);
        assertThat(store.download(7, 10, "PDF").content()).containsExactly((byte) 3, (byte) 4);
        verify(objects).getObject(xmlKey);
        verifyNoMoreInteractions(objects);
    }

    @Test
    void access_routesBothStorageKindsForInlineAndAttachment() {
        String key = "invoices/42/" + "a".repeat(64) + ".pdf";
        when(gateway.access(7, 9, "PDF")).thenReturn(grant("R2", "READY", key, "a".repeat(64), 128));
        when(gateway.access(7, 10, "PDF")).thenReturn(grant("DATABASE", "READY", null, "a".repeat(64), 128));

        for (String disposition : java.util.List.of("inline", "attachment")) {
            String streamUrl = "/api/v1/orders/10/invoice/files/PDF?disposition=" + disposition;
            var database = store.access(7, 10, "PDF", streamUrl, disposition);
            assertThat(database.access().delivery()).isEqualTo("API_STREAM");
            assertThat(database.access().url()).isEqualTo(streamUrl);
            assertThat(database.access().expiresAt()).isNull();

            var r2 = store.access(7, 9, "PDF", "/api/v1/orders/9/invoice/files/PDF?disposition=" + disposition,
                    disposition);
            assertThat(r2.fileState()).isEqualTo("READY");
            assertThat(r2.access().delivery()).isEqualTo("SIGNED_URL");
            assertThat(r2.access().url()).contains("response-content-type=application%2Fpdf",
                    "response-content-disposition=" + disposition
                            + "%3B%20filename%3D%22factura-999-999-000000042.pdf%22",
                    "X-Amz-Expires=300");
            assertThat(r2.access().expiresAt()).isEqualTo(Instant.parse("2026-10-27T12:05:00Z"));
        }
        verify(gateway, times(2)).access(7, 9, "PDF");
        verify(gateway, times(2)).access(7, 10, "PDF");
        verifyNoInteractions(objects);
    }

    @Test
    void access_deniedByDatabaseNeverInvokesSigner() {
        var signer = mock(R2PresignedUrlSigner.class);
        var deniedStore = new R2InvoiceDocumentStore(gateway, objects, signer, properties,
                Clock.fixed(Instant.parse("2026-10-27T12:00:00Z"), ZoneOffset.UTC));
        when(gateway.access(8, 9, "PDF")).thenReturn(null);

        assertThat(deniedStore.access(8, 9, "PDF", "/api/v1/orders/9/invoice/files/PDF?disposition=attachment",
                "attachment")).isNull();
        verify(gateway).access(8, 9, "PDF");
        verifyNoInteractions(signer, objects);
    }

    private static InvoiceArtifactAccessGrant grant(String kind, String state, String key, String checksum, long size) {
        return new InvoiceArtifactAccessGrant(42, "SIMULATED", state, kind, key, checksum, size,
                "application/pdf", "pliego-factura-academica-999-999-000000042.pdf", "999-999-000000042");
    }
}
