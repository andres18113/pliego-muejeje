package com.pliego.modules.catalog.application;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/** Real JDBC mapping and transaction-local limits for the later monitoring binding. */
@EnabledIfEnvironmentVariable(named = "PLIEGO_TEST_DISPOSABLE_DB", matches = "1")
@SpringBootTest(properties = {"pliego.offers.scheduler-enabled=false", "pliego.realtime.enabled=false",
        "pliego.home-delivery.scheduler-enabled=false", "pliego.mail.enabled=false", "pliego.billing.enabled=false",
        "spring.datasource.hikari.maximum-pool-size=1", "spring.datasource.hikari.minimum-idle=1"})
class OfferLifecyclePostgresIntegrationTest {
    @Autowired OfferLifecycleService service;
    @Autowired JdbcTemplate jdbc;

    @DynamicPropertySource
    static void disposableDatabase(DynamicPropertyRegistry properties) {
        String url = System.getenv("PLIEGO_DB_URL");
        if (url == null || !url.matches("jdbc:postgresql://127\\.0\\.0\\.1:[0-9]{4,5}/[a-z_]+") || url.contains(":5432/")) {
            throw new IllegalStateException("La prueba requiere una base desechable de ofertas en loopback y puerto dedicado.");
        }
        properties.add("spring.datasource.url", () -> url);
        properties.add("spring.datasource.username", () -> System.getenv("PLIEGO_DB_USERNAME"));
        properties.add("spring.datasource.password", () -> System.getenv("PLIEGO_DB_PASSWORD"));
        properties.add("spring.flyway.url", () -> url);
        properties.add("spring.flyway.user", () -> System.getenv("PLIEGO_DB_USERNAME"));
        properties.add("spring.flyway.password", () -> System.getenv("PLIEGO_DB_PASSWORD"));
    }

    @Test
    void clock_readsDatabaseTimeAndFutureDeadline_throughReadOnlyTransaction() {
        Instant before = Instant.now();
        var clock = service.clock();
        assertThat(clock.serverTime()).isBetween(before.minusSeconds(1), Instant.now().plusSeconds(1));
        assertThat(clock.revalidateAfterSeconds()).isEqualTo(60);
        if (clock.nextTransitionAt() != null) assertThat(clock.nextTransitionAt()).isAfter(clock.serverTime());
    }

    @Test
    void status_mapsDurableSuccessFailureCounters_andRestoresPooledExecutionLimits() {
        String lockTimeout = jdbc.queryForObject("SHOW lock_timeout", String.class);
        String statementTimeout = jdbc.queryForObject("SHOW statement_timeout", String.class);
        var before = service.status();
        var advance = service.advance(1000);
        assertThat(advance.state()).isEqualTo("OK");
        service.failure("DATABASE_ERROR");
        var after = service.status();
        assertThat(after.successCount()).isEqualTo(before.successCount() + 1);
        assertThat(after.failureCount()).isEqualTo(before.failureCount() + 1);
        assertThat(after.transitionCount()).isEqualTo(before.transitionCount() + advance.transitionCount());
        assertThat(after.lastSuccessAt()).isNotNull();
        assertThat(after.lastFailureAt()).isNotNull();
        assertThat(after.lastFailureCode()).isEqualTo("DATABASE_ERROR");
        assertThat(after.lagSeconds()).isNotNegative();
        assertThat(jdbc.queryForObject("SHOW lock_timeout", String.class)).isEqualTo(lockTimeout);
        assertThat(jdbc.queryForObject("SHOW statement_timeout", String.class)).isEqualTo(statementTimeout);
    }
}
