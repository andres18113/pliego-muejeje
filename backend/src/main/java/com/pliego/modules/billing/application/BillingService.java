package com.pliego.modules.billing.application;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.pliego.modules.billing.gateway.BillingGateway;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@Service
@Transactional(readOnly = true)
public class BillingService {
    private final BillingGateway gateway;
    private final ObjectMapper json;
    public BillingService(BillingGateway gateway, ObjectMapper json) { this.gateway = gateway; this.json = json; }
    public JsonNode metadata(long actorId, long orderId) {
        String value = gateway.metadata(actorId, orderId);
        return value == null ? null : json.readTree(value);
    }
    public InvoiceDownload download(long actorId, long orderId, String type) { return gateway.download(actorId, orderId, type); }
}
