package com.pliego.modules.billing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

import java.util.UUID;
import org.junit.jupiter.api.Test;
import com.pliego.modules.billing.application.*;
import com.pliego.modules.billing.gateway.BillingGateway;
import tools.jackson.databind.ObjectMapper;

class InvoiceArtifactWorkerTest {
    private final ObjectMapper json = new ObjectMapper();
    private final BillingGateway gateway = mock(BillingGateway.class);
    private final InvoiceDocumentStore documents = mock(InvoiceDocumentStore.class);
    private final InvoiceRenderer renderer = mock(InvoiceRenderer.class);
    private final InvoiceJob job = new InvoiceJob(42L, "PDF", UUID.randomUUID(), 1, "{\"invoiceId\":\"42\"}");

    private InvoiceArtifactWorker worker() {
        return new InvoiceArtifactWorker(new InvoiceArtifactService(gateway), documents, renderer, json,
                new BillingProperties(true, 2));
    }

    @Test void publishesRenderedBytesUnderTheClaimedLease() {
        when(gateway.claim()).thenReturn(job, null);
        when(renderer.render(eq("PDF"), any())).thenReturn(new byte[]{1, 2, 3});
        InvoiceStoredArtifact prepared = databaseArtifact(new byte[]{1, 2, 3});
        when(documents.prepare(eq(job), any())).thenReturn(prepared);
        when(gateway.completeStored(job, prepared)).thenReturn(true);
        worker().process();
        inOrder(documents, gateway).verify(documents).prepare(job, new byte[]{1, 2, 3});
        verify(gateway).completeStored(job, prepared);
        verify(gateway, never()).fail(any());
    }

    @Test void renderingFailureIsRecordedWithoutResubmittingThePurchase() {
        when(gateway.claim()).thenReturn(job, null);
        when(renderer.render(eq("PDF"), any())).thenThrow(new IllegalArgumentException("private buyer data"));
        worker().process();
        verify(gateway).fail(job);
        verifyNoInteractions(documents);
        verify(gateway, never()).completeStored(any(), any());
    }

    @Test void lostCompletionDoesNotFailOrOverwriteAnotherWorkersLease() {
        when(gateway.claim()).thenReturn(job, null);
        when(renderer.render(eq("PDF"), any())).thenReturn(new byte[]{1});
        when(documents.prepare(eq(job), any())).thenReturn(databaseArtifact(new byte[]{1}));
        when(gateway.completeStored(eq(job), any())).thenReturn(false);
        worker().process();
        verify(gateway, never()).fail(any());
    }

    @Test void databaseCompletionFailureLeavesTheLeaseForReconciliation() {
        when(gateway.claim()).thenReturn(job);
        when(renderer.render(eq("PDF"), any())).thenReturn(new byte[]{1});
        when(documents.prepare(eq(job), any())).thenReturn(databaseArtifact(new byte[]{1}));
        when(gateway.completeStored(eq(job), any())).thenThrow(new IllegalStateException("database unavailable"));
        worker().process();
        verify(gateway, times(1)).claim();
        verify(gateway, never()).fail(any());
    }

    @Test void uploadFailureUsesExistingFencedFailRetryPath() {
        when(gateway.claim()).thenReturn(job, null);
        when(renderer.render(eq("PDF"), any())).thenReturn(new byte[]{1});
        when(documents.prepare(eq(job), any())).thenThrow(new InvoiceDocumentUploadException());
        worker().process();
        verify(gateway).fail(job);
        verify(gateway, never()).completeStored(any(), any());
        verify(renderer, times(1)).render(eq("PDF"), any());
    }

    @Test void uploadedObjectWithDatabaseFailureIsNotRerenderedInTheSameWorkerPass() {
        when(gateway.claim()).thenReturn(job);
        when(renderer.render(eq("PDF"), any())).thenReturn(new byte[]{1});
        var uploaded = InvoiceStoredArtifact.r2("invoices/42/hash.pdf", "a".repeat(64), 1,
                "application/pdf");
        when(documents.prepare(eq(job), any())).thenReturn(uploaded);
        when(gateway.completeStored(job, uploaded)).thenThrow(new IllegalStateException("database unavailable"));
        worker().process();
        verify(gateway).completeStored(job, uploaded);
        verify(gateway, times(1)).claim();
        verify(gateway, never()).fail(any());
        verify(renderer, times(1)).render(eq("PDF"), any());
    }

    @Test void jobsNeverExposeSnapshotsThroughToString() {
        var privateJob = new InvoiceJob(job.invoiceId(), job.type(), job.owner(), job.attempt(),
                "{\"buyerName\":\"PRIVATE_SNAPSHOT_MARKER\"}");
        assertThat(privateJob.toString()).doesNotContain("PRIVATE_SNAPSHOT_MARKER").doesNotContain(job.owner().toString());
    }

    private static InvoiceStoredArtifact databaseArtifact(byte[] bytes) {
        return InvoiceStoredArtifact.database(bytes, "a".repeat(64), "application/pdf");
    }
}
