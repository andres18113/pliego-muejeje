package com.pliego.modules.catalog.application;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;
import org.springframework.stereotype.Component;

/** PostgreSQL consumes bounded due work and records durable invalidation hints. */
@Component
@ConditionalOnProperty(name = "pliego.offers.scheduler-enabled", havingValue = "true", matchIfMissing = true)
public class OfferLifecycleScheduler {
    private static final Logger LOG = LoggerFactory.getLogger(OfferLifecycleScheduler.class);
    private final OfferLifecycleService service;

    public OfferLifecycleScheduler(OfferLifecycleService service) { this.service = service; }

    @Scheduled(fixedDelay = 1000, initialDelay = 1000, scheduler = "offerLifecycleTaskScheduler")
    public void advance() {
        try {
            var result = service.advance(1000);
            if (result.transitionCount() > 0) {
                LOG.info("offer_lifecycle state={} transitionCount={} maxLagSeconds={}",
                        result.state(), result.transitionCount(), result.maxLagSeconds());
            } else {
                LOG.debug("offer_lifecycle state={} transitionCount={} maxLagSeconds={}",
                        result.state(), result.transitionCount(), result.maxLagSeconds());
            }
        } catch (RuntimeException exception) {
            LOG.warn("offer_lifecycle state=ADVANCE_FAILED code=DATABASE_ERROR");
            // The failed business transaction has already rolled back. Failure telemetry commits independently.
            try { service.failure("DATABASE_ERROR"); }
            catch (RuntimeException ignored) { LOG.warn("offer_lifecycle state=FAILURE_RECORD_FAILED code=DATABASE_ERROR"); }
        }
    }

    @Configuration
    @EnableScheduling
    @ConditionalOnProperty(name = "pliego.offers.scheduler-enabled", havingValue = "true", matchIfMissing = true)
    static class Scheduling {
        // Keep Boot's shared scheduler as the default for all existing unqualified jobs.
        @Bean(name = "offerLifecycleTaskScheduler", defaultCandidate = false)
        ThreadPoolTaskScheduler offerLifecycleTaskScheduler() {
            var scheduler = new ThreadPoolTaskScheduler();
            scheduler.setPoolSize(1);
            scheduler.setThreadNamePrefix("offer-lifecycle-");
            return scheduler;
        }
    }
}
