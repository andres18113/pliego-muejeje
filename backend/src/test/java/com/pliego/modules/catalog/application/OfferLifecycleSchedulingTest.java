package com.pliego.modules.catalog.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.math.BigDecimal;
import com.pliego.modules.catalog.gateway.OfferLifecycleGateway;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.autoconfigure.task.TaskSchedulingAutoConfiguration;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;

class OfferLifecycleSchedulingTest {
    @Test
    void offerWork_usesItsDedicatedScheduler_evenWhenTheDefaultSchedulerIsBusy() {
        new ApplicationContextRunner()
                .withPropertyValues("pliego.offers.scheduler-enabled=true")
                .withUserConfiguration(OfferLifecycleScheduler.Scheduling.class)
                .withBean("taskScheduler", ThreadPoolTaskScheduler.class, ThreadPoolTaskScheduler::new)
                .withBean(OfferLifecycleScheduler.class,
                        () -> new OfferLifecycleScheduler(service()))
                .run(context -> {
                    var offers = context.getBean("offerLifecycleTaskScheduler", ThreadPoolTaskScheduler.class);
                    var shared = context.getBean("taskScheduler", ThreadPoolTaskScheduler.class);
                    assertThat(offers.getPoolSize()).isEqualTo(1);
                    assertThat(offers.getScheduledThreadPoolExecutor().getQueue()).hasSize(1);
                    assertThat(shared.getScheduledThreadPoolExecutor().getQueue()).isEmpty();
                });
    }

    @Test
    void disablingOfferScheduling_doesNotCreateAnotherScheduler() {
        new ApplicationContextRunner()
                .withUserConfiguration(OfferLifecycleScheduler.Scheduling.class)
                .withPropertyValues("pliego.offers.scheduler-enabled=false")
                .run(context -> assertThat(context).doesNotHaveBean("offerLifecycleTaskScheduler"));
    }

    @Test
    void dedicatedScheduler_preservesBootDefaultScheduler_forOtherWorkers() {
        new ApplicationContextRunner()
                .withPropertyValues("pliego.offers.scheduler-enabled=true")
                .withConfiguration(AutoConfigurations.of(TaskSchedulingAutoConfiguration.class))
                .withUserConfiguration(OfferLifecycleScheduler.Scheduling.class)
                .withBean(OfferLifecycleScheduler.class,
                        () -> new OfferLifecycleScheduler(service()))
                .withBean(SharedWorker.class, SharedWorker::new)
                .run(context -> {
                    var offers = context.getBean("offerLifecycleTaskScheduler", ThreadPoolTaskScheduler.class);
                    var shared = context.getBean("taskScheduler", ThreadPoolTaskScheduler.class);
                    assertThat(offers).isNotSameAs(shared);
                    assertThat(offers.getScheduledThreadPoolExecutor().getQueue()).hasSize(1);
                    assertThat(shared.getScheduledThreadPoolExecutor().getQueue()).hasSize(1);
                });
    }

    static class SharedWorker {
        @Scheduled(fixedDelay = 60000, initialDelay = 60000)
        public void run() { }
    }

    private OfferLifecycleService service() {
        var gateway = mock(OfferLifecycleGateway.class);
        when(gateway.advance(1000)).thenReturn(new OfferLifecycleAdvance("OK", 0, BigDecimal.ZERO));
        return new OfferLifecycleService(gateway);
    }
}
