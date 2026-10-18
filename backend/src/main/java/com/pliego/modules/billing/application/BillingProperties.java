package com.pliego.modules.billing.application;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

@ConfigurationProperties("pliego.billing")
public record BillingProperties(@DefaultValue("true") boolean enabled, @DefaultValue("4") int batchSize) {
    public BillingProperties {
        if (batchSize < 1 || batchSize > 100) throw new IllegalArgumentException("El lote de facturación debe estar entre 1 y 100.");
    }
}
