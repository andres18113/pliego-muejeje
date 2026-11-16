package com.pliego.modules.realtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.DriverManager;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Supplier;
import com.pliego.foundation.database.DatabaseException;
import com.pliego.modules.realtime.application.RealtimeService;
import com.pliego.modules.realtime.gateway.JdbcRealtimeGateway;
import com.pliego.modules.realtime.gateway.RealtimeGateway;
import com.zaxxer.hikari.HikariDataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.aop.support.AopUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/** Real Spring transactions and PG18 locks; no test-wide transaction or mock database. */
@EnabledIfEnvironmentVariable(named = "PLIEGO_TEST_DISPOSABLE_DB", matches = "1")
@SpringBootTest(properties = {
        "pliego.realtime.enabled=false", "pliego.mail.enabled=false", "pliego.billing.enabled=false",
        "pliego.home-delivery.scheduler-enabled=false", "spring.datasource.hikari.maximum-pool-size=1",
        "spring.datasource.hikari.minimum-idle=1", "spring.datasource.hikari.connection-timeout=2000"
})
@Import(RealtimeTransactionPostgresIntegrationTest.ProbeConfiguration.class)
class RealtimeTransactionPostgresIntegrationTest {
    @Autowired RealtimeService service;
    @Autowired JdbcTemplate jdbc;
    @Autowired HikariDataSource pool;
    @Autowired RecordingGateway gateway;
    private Settings original;
    private Settings baseline;
    private long actor;
    private String cookie;

    /** Runs before a Spring datasource/Flyway connection can be opened. */
    @DynamicPropertySource
    static void requireDedicatedDisposableDatabase(DynamicPropertyRegistry properties) {
        String url = System.getenv("PLIEGO_DB_URL");
        if (url == null || !url.startsWith("jdbc:postgresql://127.0.0.1:")) {
            throw new IllegalStateException("La prueba requiere PostgreSQL desechable en loopback.");
        }
        URI target = URI.create(url.substring("jdbc:".length()));
        if (target.getPort() < 1024 || target.getPort() > 65535
                || List.of(5432, 55436, 55539).contains(target.getPort())
                || target.getRawQuery() != null || target.getFragment() != null || target.getUserInfo() != null) {
            throw new IllegalStateException("La prueba requiere un puerto dedicado y una URL sin opciones.");
        }
        properties.add("spring.datasource.url", () -> url);
        properties.add("spring.datasource.username", () -> System.getenv("PLIEGO_DB_USERNAME"));
        properties.add("spring.datasource.password", () -> System.getenv("PLIEGO_DB_PASSWORD"));
        // Flyway can need concurrent startup connections; application commands
        // must still share the one physical Hikari session exercised below.
        properties.add("spring.flyway.url", () -> url);
        properties.add("spring.flyway.user", () -> System.getenv("PLIEGO_DB_USERNAME"));
        properties.add("spring.flyway.password", () -> System.getenv("PLIEGO_DB_PASSWORD"));
    }

    @BeforeEach
    void createSyntheticSessionOnTheOnlyPooledConnection() throws Exception {
        assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isFalse();
        assertThat(AopUtils.isAopProxy(service)).isTrue();
        assertThat(pool.getMaximumPoolSize()).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT current_setting('server_version_num')::integer", Integer.class))
                .isBetween(180000, 189999);
        gateway.observed.clear();
        gateway.rollbackAfterConnect.set(false);
        original = settings(jdbc);
        String email = "realtime-timeout-" + UUID.randomUUID() + "@example.invalid";
        jdbc.queryForMap("CALL pliego.sp_customer_register(?,'fixture-hash','Cliente','Tiempo',NULL,NULL,NULL,NULL)", email);
        actor = jdbc.queryForObject("SELECT usuario_id FROM pliego.usuario WHERE email_normalizado=?", Long.class, email);
        jdbc.update("UPDATE pliego.usuario SET email_verificado_en=clock_timestamp() WHERE usuario_id=?", actor);
        cookie = Base64.getUrlEncoder().withoutPadding().encodeToString(UUID.randomUUID().toString()
                .getBytes(StandardCharsets.US_ASCII)).substring(0, 43);
        String digest = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                .digest(cookie.getBytes(StandardCharsets.US_ASCII)));
        assertThat(jdbc.queryForObject("SELECT pliego.fn_auth_session_create_checked(?,?,clock_timestamp()+interval '1 day','fixture-hash')",
                Boolean.class, actor, digest)).isTrue();
        // Non-default session values make transaction-local reset observable.
        jdbc.execute("SET lock_timeout='3s'");
        jdbc.execute("SET statement_timeout='7s'");
        baseline = settings(jdbc);
    }

    @AfterEach
    void restoreTheSameSessionWithoutRetainingTestLeases() {
        gateway.rollbackAfterConnect.set(false);
        if (original != null) {
            jdbc.update("DELETE FROM pliego.realtime_connection WHERE user_id=?", actor);
            jdbc.queryForObject("SELECT set_config('lock_timeout',?,false)", String.class, original.lockTimeout());
            jdbc.queryForObject("SELECT set_config('statement_timeout',?,false)", String.class, original.statementTimeout());
        }
    }

    @Test
    void successfulCommandsUseLocalLimitsAndRestoreTheSamePhysicalConnection() {
        // Reuse each prepared SQL shape past PGJDBC's default threshold of five,
        // including both nullable and non-null BIGINT cursor bindings.
        for (int iteration = 0; iteration < 7; iteration++) {
            UUID connection = UUID.randomUUID();
            assertThat(service.connect(cookie, connection)).isEqualTo("CONNECTED");
            assertLocalSettingsAndReset();
            var initial = service.read(connection, null);
            assertThat(initial.open()).isTrue();
            assertThat(initial.resync()).isTrue();
            assertLocalSettingsAndReset();
            var resumed = service.read(connection, Long.valueOf(initial.cursor()));
            assertThat(resumed.open()).isTrue();
            assertThat(resumed.resync()).isFalse();
            assertLocalSettingsAndReset();
            service.disconnect(connection);
            assertLocalSettingsAndReset();
            assertThat(leaseCount(connection)).isZero();
        }
        assertThat(gateway.observed).hasSize(28);
    }

    @Test
    void rollbackRestoresSettingsAndDoesNotCommitTheNewLease() {
        UUID connection = UUID.randomUUID();
        gateway.rollbackAfterConnect.set(true);
        assertThatThrownBy(() -> service.connect(cookie, connection)).isInstanceOf(ForcedRollback.class);
        assertLocalSettingsAndReset();
        assertThat(leaseCount(connection)).isZero();
        assertThat(service.connect(cookie, connection)).isEqualTo("CONNECTED");
        assertLocalSettingsAndReset();
    }

    @Test
    void blockedConnectFailsWithLockTimeoutAndLeavesNoAdmission() throws Exception {
        UUID connection = UUID.randomUUID();
        withLeaseTableLocked(() -> assertFastLockTimeout(() -> service.connect(cookie, connection)));
        assertThat(leaseCount(connection)).isZero();
        assertThat(settings(jdbc)).isEqualTo(baseline);
        assertThat(service.connect(cookie, connection)).isEqualTo("CONNECTED");
    }

    @Test
    void blockedReadAndDisconnectRollBackWithoutLeakingLocalLimits() throws Exception {
        UUID connection = UUID.randomUUID();
        assertThat(service.connect(cookie, connection)).isEqualTo("CONNECTED");
        withLeaseTableLocked(() -> assertFastLockTimeout(() -> service.read(connection, null)));
        assertThat(settings(jdbc)).isEqualTo(baseline);
        assertThat(leaseCount(connection)).isEqualTo(1);
        withLeaseTableLocked(() -> assertFastLockTimeout(() -> {
            service.disconnect(connection);
            return null;
        }));
        assertThat(settings(jdbc)).isEqualTo(baseline);
        assertThat(leaseCount(connection)).isEqualTo(1);
        service.disconnect(connection);
        assertThat(leaseCount(connection)).isZero();
    }

    private void assertLocalSettingsAndReset() {
        assertThat(gateway.observed).isNotEmpty();
        Settings inside = gateway.observed.getLast();
        assertThat(inside.pid()).isEqualTo(baseline.pid());
        assertThat(inside.lockTimeout()).isEqualTo("100ms");
        assertThat(inside.statementTimeout()).isIn("1s", "1000ms");
        assertThat(settings(jdbc)).isEqualTo(baseline);
    }

    private void assertFastLockTimeout(Supplier<?> operation) {
        long started = System.nanoTime();
        assertThatThrownBy(operation::get).isInstanceOfSatisfying(DatabaseException.class,
                error -> assertThat(error.sqlState()).isEqualTo("55P03"));
        assertThat(TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started))
                .as("The server's 100ms lock limit must act before the 1s statement limit")
                .isLessThan(900);
    }

    private int leaseCount(UUID connection) {
        return jdbc.queryForObject("SELECT count(*) FROM pliego.realtime_connection WHERE connection_id=?", Integer.class, connection);
    }

    private void withLeaseTableLocked(Runnable operation) throws Exception {
        var locked = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        try (var worker = Executors.newSingleThreadExecutor()) {
            var holder = worker.submit(() -> {
                try (var connection = DriverManager.getConnection(System.getenv("PLIEGO_DB_URL"),
                        System.getenv("PLIEGO_DB_USERNAME"), System.getenv("PLIEGO_DB_PASSWORD"))) {
                    connection.setAutoCommit(false);
                    try (var statement = connection.createStatement()) {
                        statement.setQueryTimeout(3);
                        statement.execute("LOCK TABLE pliego.realtime_connection IN ACCESS EXCLUSIVE MODE");
                        locked.countDown();
                        // Failure-safe release makes a missing implementation fail, rather than hang.
                        release.await(3, TimeUnit.SECONDS);
                    } finally {
                        connection.rollback();
                    }
                }
                return null;
            });
            try {
                assertThat(locked.await(5, TimeUnit.SECONDS)).isTrue();
                operation.run();
            } finally {
                release.countDown();
                holder.get(5, TimeUnit.SECONDS);
            }
        }
    }

    private static Settings settings(JdbcTemplate jdbc) {
        return jdbc.queryForObject("SELECT pg_backend_pid(),current_setting('lock_timeout'),current_setting('statement_timeout')",
                (row, index) -> new Settings(row.getInt(1), row.getString(2), row.getString(3)));
    }

    private record Settings(int pid, String lockTimeout, String statementTimeout) { }
    private static final class ForcedRollback extends RuntimeException { }

    @TestConfiguration(proxyBeanMethods = false)
    static class ProbeConfiguration {
        @Bean @Primary
        RecordingGateway recordingGateway(JdbcRealtimeGateway delegate, JdbcTemplate jdbc) {
            return new RecordingGateway(delegate, jdbc);
        }
    }

    /** Observes the real gateway after its SQL, while the service proxy still owns the transaction. */
    static final class RecordingGateway implements RealtimeGateway {
        private final RealtimeGateway delegate;
        private final JdbcTemplate jdbc;
        final List<Settings> observed = new CopyOnWriteArrayList<>();
        final AtomicBoolean rollbackAfterConnect = new AtomicBoolean();
        RecordingGateway(RealtimeGateway delegate, JdbcTemplate jdbc) { this.delegate = delegate; this.jdbc = jdbc; }
        public String connect(String hash, UUID connection) {
            String state = delegate.connect(hash, connection);
            observed.add(settings(jdbc));
            if (rollbackAfterConnect.getAndSet(false)) throw new ForcedRollback();
            return state;
        }
        public Batch read(UUID connection, Long cursor) {
            Batch batch = delegate.read(connection, cursor);
            observed.add(settings(jdbc));
            return batch;
        }
        public void disconnect(UUID connection) { delegate.disconnect(connection); observed.add(settings(jdbc)); }
        public void publish() { delegate.publish(); }
    }
}
