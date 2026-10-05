package com.pliego.modules.sales.application;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** See ADR0024. Timing and transitions belong to PostgreSQL. */
@Component
@ConditionalOnProperty(name = "pliego.home-delivery.scheduler-enabled", havingValue = "true", matchIfMissing = true)
public class HomeDeliveryScheduler {
    private static final Logger LOG = LoggerFactory.getLogger(HomeDeliveryScheduler.class);
    private final HomeDeliveryService service;
    private final int batchSize;

    public HomeDeliveryScheduler(HomeDeliveryService service,
            @Value("${pliego.home-delivery.batch-size:100}") int batchSize) {
        if (batchSize < 1 || batchSize > 1000) {
            throw new IllegalArgumentException("El tamaño del lote debe estar entre 1 y 1000.");
        }
        this.service = service;
        this.batchSize = batchSize;
    }

    @Scheduled(fixedDelayString = "${pliego.home-delivery.poll-interval:PT10S}",
            initialDelayString = "${pliego.home-delivery.poll-interval:PT10S}")
    public void advance() {
        try {
            service.advanceDue(batchSize);
        } catch (RuntimeException exception) {
            LOG.warn("home_delivery state=ADVANCE_FAILED code=DATABASE_ERROR");
        }
    }

    @Configuration
    @EnableScheduling
    @ConditionalOnProperty(name = "pliego.home-delivery.scheduler-enabled", havingValue = "true", matchIfMissing = true)
    static class Scheduling { }
}
