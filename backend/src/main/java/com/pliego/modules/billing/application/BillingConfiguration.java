package com.pliego.modules.billing.application;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Bean;
import org.springframework.scheduling.annotation.EnableScheduling;
import com.pliego.modules.billing.gateway.BillingGateway;

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties({BillingProperties.class, R2StorageProperties.class})
public class BillingConfiguration {
    @Bean
    public InvoiceDocumentStore invoiceDocumentStore(R2StorageProperties r2, BillingGateway gateway,
            R2RequestSigner requestSigner, R2PresignedUrlSigner presignedUrlSigner) {
        if (!r2.enabled()) return new DatabaseInvoiceDocumentStore(gateway);
        r2.validate();
        return new R2InvoiceDocumentStore(gateway, new R2ObjectClient(r2, requestSigner), presignedUrlSigner, r2);
    }

    @Configuration(proxyBeanMethods = false)
    @EnableScheduling
    @ConditionalOnProperty(name = "pliego.billing.enabled", havingValue = "true", matchIfMissing = true)
    static class Scheduling { }
}
