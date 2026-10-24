package com.pliego.modules.billing;

import static org.assertj.core.api.Assertions.assertThat;
import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Configuration;
import com.pliego.modules.billing.application.BillingProperties;

class BillingPropertiesTest {
    private final ApplicationContextRunner context = new ApplicationContextRunner().withUserConfiguration(Config.class);

    @Configuration(proxyBeanMethods = false)
    @EnableConfigurationProperties(BillingProperties.class)
    static class Config { }

    @Test void bindsExplicitWorkerSettings() {
        context.withPropertyValues("pliego.billing.enabled=true", "pliego.billing.batch-size=4").run(c -> {
            assertThat(c).hasNotFailed();
            assertThat(c.getBean(BillingProperties.class).batchSize()).isEqualTo(4);
            assertThat(c.getBean(BillingProperties.class).enabled()).isTrue();
        });
    }

    @Test void rejectsUnboundedWorkerBatch() {
        context.withPropertyValues("pliego.billing.batch-size=0").run(c -> assertThat(c).hasFailed());
    }
}
