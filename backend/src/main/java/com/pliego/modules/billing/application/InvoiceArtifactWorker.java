package com.pliego.modules.billing.application;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

@Component
@ConditionalOnProperty(name = "pliego.billing.enabled", havingValue = "true", matchIfMissing = true)
public class InvoiceArtifactWorker {
    private static final Logger LOG = LoggerFactory.getLogger(InvoiceArtifactWorker.class);
    private final InvoiceArtifactService service;
    private final InvoiceDocumentStore documents;
    private final InvoiceRenderer renderer;
    private final ObjectMapper json;
    private final BillingProperties properties;

    public InvoiceArtifactWorker(InvoiceArtifactService service, InvoiceDocumentStore documents, InvoiceRenderer renderer,
            ObjectMapper json, BillingProperties properties) {
        this.service = service; this.documents = documents; this.renderer = renderer; this.json = json; this.properties = properties;
    }

    @Scheduled(fixedDelayString = "${pliego.billing.poll-interval:PT5S}", initialDelayString = "${pliego.billing.poll-interval:PT5S}")
    public void process() {
        for (int n = 0; n < properties.batchSize(); n++) {
            InvoiceJob job;
            try { job = service.claim(); }
            catch (RuntimeException e) { LOG.warn("invoice_artifact state=CLAIM_FAILED code=DATABASE_ERROR"); return; }
            if (job == null) return;
            byte[] bytes;
            try { bytes = renderer.render(job.type(), json.readTree(job.snapshot())); }
            catch (RuntimeException e) {
                try { service.fail(job); }
                catch (RuntimeException failure) { LOG.warn("invoice_artifact id={} type={} code=FAILURE_RECORDING_FAILED", job.invoiceId(), job.type()); return; }
                LOG.warn("invoice_artifact id={} type={} code=RENDER_FAILED", job.invoiceId(), job.type());
                continue;
            }
            InvoiceStoredArtifact stored;
            try { stored = documents.prepare(job, bytes); }
            catch (InvoiceDocumentUploadException e) {
                try { service.fail(job); }
                catch (RuntimeException failure) {
                    LOG.warn("invoice_artifact id={} type={} code=UPLOAD_FAILURE_RECORDING_FAILED", job.invoiceId(), job.type());
                    return;
                }
                LOG.warn("invoice_artifact id={} type={} code=UPLOAD_FAILED", job.invoiceId(), job.type());
                continue;
            }
            try {
                boolean applied = service.complete(job, stored);
                LOG.info("invoice_artifact id={} type={} state={}", job.invoiceId(), job.type(), applied ? "READY" : "STALE_COMPLETION");
            } catch (RuntimeException e) {
                // Commit may be uncertain: do not fail/release the lease or render again here.
                LOG.warn("invoice_artifact id={} type={} code=COMPLETION_UNCERTAIN", job.invoiceId(), job.type());
                return;
            }
        }
    }
}
