package com.pliego.modules.billing.application;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import com.pliego.modules.billing.gateway.BillingGateway;

@Service
public class InvoiceArtifactService {
    private final BillingGateway gateway;
    public InvoiceArtifactService(BillingGateway gateway) { this.gateway = gateway; }
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public InvoiceJob claim() { return gateway.claim(); }
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public boolean complete(InvoiceJob job, InvoiceStoredArtifact artifact) { return gateway.completeStored(job, artifact); }
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public boolean fail(InvoiceJob job) { return gateway.fail(job); }
}
