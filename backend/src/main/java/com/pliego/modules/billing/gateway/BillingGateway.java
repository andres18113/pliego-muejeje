package com.pliego.modules.billing.gateway;

import com.pliego.modules.billing.application.InvoiceDownload;
import com.pliego.modules.billing.application.InvoiceJob;

public interface BillingGateway {
    String metadata(long actorId, long orderId);
    InvoiceDownload download(long actorId, long orderId, String type);
    InvoiceJob claim();
    boolean complete(InvoiceJob job, byte[] content);
    boolean fail(InvoiceJob job);
}
