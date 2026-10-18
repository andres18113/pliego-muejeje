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
    private final InvoiceRenderer renderer = mock(InvoiceRenderer.class);
    private final InvoiceJob job = new InvoiceJob(42L, "PDF", UUID.randomUUID(), 1, "{\"invoiceId\":\"42\"}");

    private InvoiceArtifactWorker worker() {
        return new InvoiceArtifactWorker(new InvoiceArtifactService(gateway), renderer, json,
                new BillingProperties(true, 2));
    }

    @Test void publishesRenderedBytesUnderTheClaimedLease() {
        when(gateway.claim()).thenReturn(job, null);
        when(renderer.render(eq("PDF"), any())).thenReturn(new byte[]{1, 2, 3});
        when(gateway.complete(eq(job), any())).thenReturn(true);
        worker().process();
        verify(gateway).complete(job, new byte[]{1, 2, 3});
        verify(gateway, never()).fail(any());
    }

    @Test void renderingFailureIsRecordedWithoutResubmittingThePurchase() {
        when(gateway.claim()).thenReturn(job, null);
        when(renderer.render(eq("PDF"), any())).thenThrow(new IllegalArgumentException("private buyer data"));
        worker().process();
        verify(gateway).fail(job);
        verify(gateway, never()).complete(any(), any());
    }

    @Test void lostCompletionDoesNotFailOrOverwriteAnotherWorkersLease() {
        when(gateway.claim()).thenReturn(job, null);
        when(renderer.render(eq("PDF"), any())).thenReturn(new byte[]{1});
        when(gateway.complete(eq(job), any())).thenReturn(false);
        worker().process();
        verify(gateway, never()).fail(any());
    }

    @Test void databaseCompletionFailureLeavesTheLeaseForReconciliation() {
        when(gateway.claim()).thenReturn(job);
        when(renderer.render(eq("PDF"), any())).thenReturn(new byte[]{1});
        when(gateway.complete(eq(job), any())).thenThrow(new IllegalStateException("database unavailable"));
        worker().process();
        verify(gateway, times(1)).claim();
        verify(gateway, never()).fail(any());
    }

    @Test void jobsNeverExposeSnapshotsThroughToString() {
        var privateJob = new InvoiceJob(job.invoiceId(), job.type(), job.owner(), job.attempt(),
                "{\"buyerName\":\"PRIVATE_SNAPSHOT_MARKER\"}");
        assertThat(privateJob.toString()).doesNotContain("PRIVATE_SNAPSHOT_MARKER").doesNotContain(job.owner().toString());
    }
}
