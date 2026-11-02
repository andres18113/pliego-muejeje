package com.pliego.modules.identity.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

import java.net.InetAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.sql.DriverManager;
import java.util.ArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import com.pliego.modules.identity.application.EmailActionTokens;
import com.pliego.modules.identity.application.LoginAttemptMaintenance;
import tools.jackson.databind.ObjectMapper;

/** Actual HTTP/Tomcat, BCrypt spy and committed PostgreSQL state; never a test-wide rollback. */
@EnabledIfEnvironmentVariable(named = "PLIEGO_TEST_DISPOSABLE_DB", matches = "1")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "pliego.mail.enabled=false", "pliego.billing.enabled=false",
        "pliego.home-delivery.scheduler-enabled=false", "server.address=127.0.0.1",
        "spring.datasource.hikari.maximum-pool-size=8",
        "pliego.cors.allowed-origins=https://spa.example.invalid"
})
class LoginAttemptPostgresIntegrationTest {
    @LocalServerPort int port;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;
    @Autowired LoginAttemptMaintenance maintenance;
    @MockitoSpyBean PasswordEncoder passwords;
    @MockitoSpyBean com.pliego.modules.identity.gateway.RegistrationContinuationGateway continuations;
    private final HttpClient http = HttpClient.newHttpClient();
    private static final String PASSWORD = "test-only-login-password-123";

    @BeforeAll
    static void requireDisposableLoopbackDatabase() {
        assertThat(System.getenv("PGHOST")).isEqualTo("127.0.0.1");
        assertThat(System.getenv("PLIEGO_DB_URL")).startsWith("jdbc:postgresql://127.0.0.1:");
    }

    @ParameterizedTest
    @ValueSource(booleans = {true, false})
    void eightDifferentAccountsShareIpWithoutHoldingBudgetLocksDuringBcrypt(boolean forwarded) throws Exception {
        int concurrent = 8;
        String sharedIp = forwarded ? ip() : "127.0.0.1";
        var accounts = new ArrayList<Account>();
        for (int n = 0; n < concurrent; n++) accounts.add(account(true));
        int previousVerifications = count(key("IP", accounts.getFirst().email(), sharedIp), "verificaciones");
        var enteredBcrypt = new CountDownLatch(concurrent);
        var releaseBcrypt = new CountDownLatch(1);
        org.mockito.Mockito.doAnswer(call -> {
            enteredBcrypt.countDown();
            if (!releaseBcrypt.await(20, TimeUnit.SECONDS)) throw new AssertionError("BCrypt test barrier timed out");
            return call.callRealMethod();
        }).when(passwords).matches(org.mockito.ArgumentMatchers.eq(PASSWORD), any());
        try (var workers = Executors.newFixedThreadPool(concurrent)) {
            var requests = accounts.stream().map(account -> workers.submit(() ->
                    login(account.email(), PASSWORD, forwarded ? sharedIp : null))).toList();
            try {
                assertThat(enteredBcrypt.await(10, TimeUnit.SECONDS))
                        .as("all eight password verifiers must enter before any verifier is released; remaining=%s", enteredBcrypt.getCount())
                        .isTrue();
                // A separate physical observer avoids borrowing one of the eight busy outcome connections.
                try (var observer = DriverManager.getConnection(System.getenv("PLIEGO_DB_URL"),
                        System.getenv("PLIEGO_DB_USERNAME"), System.getenv("PLIEGO_DB_PASSWORD"))) {
                    observer.setAutoCommit(false);
                    try (var budget = observer.prepareStatement("SELECT verificaciones FROM pliego.login_intento_limite WHERE clave=? FOR UPDATE NOWAIT")) {
                        budget.setString(1, key("IP", accounts.getFirst().email(), sharedIp));
                        try (var row = budget.executeQuery()) {
                            assertThat(row.next()).isTrue();
                            assertThat(row.getInt(1)).isEqualTo(previousVerifications + concurrent);
                        }
                        for (var account : accounts) {
                            budget.setString(1, key("AC", account.email(), sharedIp));
                            try (var row = budget.executeQuery()) {
                                assertThat(row.next()).isTrue();
                                assertThat(row.getInt(1)).isEqualTo(1);
                            }
                        }
                    } finally { observer.rollback(); }
                }
            } finally { releaseBcrypt.countDown(); }
            for (var request : requests) assertThat(request.get(30, TimeUnit.SECONDS).statusCode()).isEqualTo(200);
            for (var account : accounts) assertThat(count(pair(account.email(), sharedIp), "fallos")).isZero();
        } finally {
            releaseBcrypt.countDown();
            org.mockito.Mockito.doCallRealMethod().when(passwords).matches(any(), any());
        }
    }

    @Test
    void infrastructureFailureKeepsCommittedBudgetsButRollsBackPairAndSession() throws Exception {
        var account = account(true);
        String ip = ip();
        assertThat(login(account.email(), "wrong-password", ip).statusCode()).isEqualTo(401);
        assertThat(count(pair(account.email(), ip), "fallos")).isEqualTo(1);
        // Invalidation runs after AuthService has created the session and cleared AP.
        org.mockito.Mockito.doThrow(new IllegalStateException("Fallo de infraestructura de prueba"))
                .when(continuations).invalidate(org.mockito.ArgumentMatchers.eq(account.id()), org.mockito.ArgumentMatchers.isNull());
        try {
            assertThat(login(account.email(), PASSWORD, ip).statusCode()).isEqualTo(500);
        } finally {
            org.mockito.Mockito.doCallRealMethod().when(continuations)
                    .invalidate(org.mockito.ArgumentMatchers.eq(account.id()), org.mockito.ArgumentMatchers.isNull());
        }
        for (String scope : new String[]{"IP", "AC"}) {
            assertThat(count(key(scope, account.email(), ip), "solicitudes")).isEqualTo(2);
            assertThat(count(key(scope, account.email(), ip), "verificaciones")).isEqualTo(2);
        }
        assertThat(count(pair(account.email(), ip), "solicitudes")).isEqualTo(1);
        assertThat(count(pair(account.email(), ip), "fallos")).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM pliego.sesion_autenticacion WHERE usuario_id=?",
                Integer.class, account.id())).isZero();
    }

    @Test
    @ExtendWith(OutputCaptureExtension.class)
    void burstCommitsFailuresAndLimitedAttemptsWithoutBcryptAndLogsOnlyRedactedFields(CapturedOutput output) throws Exception {
        String email = unknown();
        String ip = ip();
        for (int i = 0; i < 5; i++) assertThat(login(email, "wrong-password", ip).statusCode()).isEqualTo(401);
        clearInvocations(passwords);
        var response = login(email, "wrong-password", ip);
        assertLimited(response);
        verify(passwords, never()).matches(any(), any());
        assertThat(count(pair(email, ip), "solicitudes")).isEqualTo(6);
        assertThat(count(pair(email, ip), "fallos")).isEqualTo(5);
        assertThat(output.getAll()).contains("login_attempt state=LIMITED code=AUTH_LOGIN_RATE_LIMITED retry_after_seconds=")
                .doesNotContain(email, ip, "wrong-password", EmailActionTokens.hash(email), EmailActionTokens.hash(ip));
    }

    @ParameterizedTest
    @ValueSource(strings = {"IP", "AC", "AP"})
    void eachScopeRejectsBeforeBcryptWithSpanishProblemAndRetryAfter(String scope) throws Exception {
        var account = account(true);
        String ip = ip();
        assertThat(login(account.email(), "wrong-password", ip).statusCode()).isEqualTo(401);
        String key = key(scope, account.email(), ip);
        if (scope.equals("AP")) jdbc.update("UPDATE pliego.login_intento_limite SET bloqueado_hasta=clock_timestamp()+INTERVAL '1 minute' WHERE clave=?", key);
        else jdbc.update("UPDATE pliego.login_intento_limite SET verificaciones=? WHERE clave=?", scope.equals("IP") ? 600 : 60, key);
        clearInvocations(passwords);
        assertLimited(login(account.email(), PASSWORD, ip));
        verify(passwords, never()).matches(any(), any());
    }

    @Test
    void unknownAndKnownWrongPasswordsUseSameBcryptAndBucketsIncludingCanonicalEmail() throws Exception {
        var account = account(true);
        String unknown = unknown();
        String ipA = ip(), ipB = ip();
        clearInvocations(passwords);
        var known = login(account.email().toUpperCase(java.util.Locale.ROOT), "wrong-password", ipA);
        var missing = login(unknown, "wrong-password", ipB);
        verify(passwords, times(2)).matches(any(), any()); // Real account hash and existing dummy hash.
        assertThat(known.statusCode()).isEqualTo(401);
        assertThat(missing.statusCode()).isEqualTo(401);
        assertThat(json.readTree(known.body()).get("detail")).isEqualTo(json.readTree(missing.body()).get("detail"));
        assertThat(count(pair(account.email(), ipA), "fallos")).isEqualTo(count(pair(unknown, ipB), "fallos")).isEqualTo(1);
        for (int i = 1; i < 5; i++) {
            assertThat(login(account.email(), "wrong-password", ipA).statusCode()).isEqualTo(401);
            assertThat(login(unknown, "wrong-password", ipB).statusCode()).isEqualTo(401);
        }
        clearInvocations(passwords);
        assertLimited(login(account.email(), "wrong-password", ipA));
        assertLimited(login(unknown, "wrong-password", ipB));
        verify(passwords, never()).matches(any(), any());
    }

    @Test
    void successfulLoginClearsOnlyPairFailureStateAndPreservesGlobalCounters() throws Exception {
        var account = account(true);
        String ip = ip();
        for (int i = 0; i < 4; i++) assertThat(login(account.email(), "wrong-password", ip).statusCode()).isEqualTo(401);
        var success = login(account.email(), PASSWORD, ip);
        assertThat(success.statusCode()).isEqualTo(200);
        assertThat(success.headers().allValues("Set-Cookie")).anyMatch(value -> value.startsWith("pliego_session="));
        assertThat(count(pair(account.email(), ip), "fallos")).isZero();
        assertThat(count(key("AC", account.email(), ip), "solicitudes")).isEqualTo(5);
        assertThat(count(key("AC", account.email(), ip), "verificaciones")).isEqualTo(5);
        assertThat(count(key("IP", account.email(), ip), "verificaciones")).isEqualTo(5);
        for (int i = 0; i < 5; i++) assertThat(login(account.email(), "wrong-password", ip).statusCode()).isEqualTo(401);
        assertLimited(login(account.email(), PASSWORD, ip));
    }

    @Test
    void deniedPairFloodIsCountedWithoutLockingOutOwnerAtAnotherIp() throws Exception {
        var account = account(true);
        String attackerIp = ip();
        for (int i = 0; i < 5; i++) assertThat(login(account.email(), "wrong-password", attackerIp).statusCode()).isEqualTo(401);
        // Seed the already-observed flood count, then exercise another real rejection.
        jdbc.update("UPDATE pliego.login_intento_limite SET solicitudes=600 WHERE clave IN (?,?,?)",
                pair(account.email(), attackerIp), key("AC", account.email(), attackerIp), key("IP", account.email(), attackerIp));
        assertLimited(login(account.email(), "wrong-password", attackerIp));
        assertThat(count(key("AC", account.email(), attackerIp), "solicitudes")).isEqualTo(601);
        assertThat(count(key("AC", account.email(), attackerIp), "verificaciones")).isEqualTo(5);
        assertThat(login(account.email(), PASSWORD, ip()).statusCode()).isEqualTo(200);
    }

    @Test
    void unverifiedAndDisabledAccountsKeepResponsesAndCannotBypassQuotas() throws Exception {
        var account = account(false);
        String ip = ip();
        for (int i = 0; i < 5; i++) {
            var response = login(account.email(), PASSWORD, ip);
            assertThat(response.statusCode()).isEqualTo(403);
            assertThat(json.readTree(response.body()).get("code").asString()).isEqualTo("EMAIL_NOT_VERIFIED");
        }
        assertLimited(login(account.email(), PASSWORD, ip));
        var disabled = account(true);
        jdbc.update("UPDATE pliego.usuario SET estado='BLOCKED' WHERE usuario_id=?", disabled.id());
        ip = ip();
        for (int i = 0; i < 5; i++) assertThat(login(disabled.email(), PASSWORD, ip).statusCode()).isEqualTo(401);
        assertLimited(login(disabled.email(), PASSWORD, ip));
    }

    @Test
    void tomcatTrustsForwardedAddressFromConfiguredLoopbackProxy() throws Exception {
        String ip = ip(), email = unknown();
        assertThat(login(email, "wrong-password", ip).statusCode()).isEqualTo(401);
        assertThat(count("IP:" + EmailActionTokens.hash(ip), "solicitudes")).isEqualTo(1);
    }

    @Test
    void tomcatIgnoresSpoofedForwardedAddressFromUntrustedPeer() throws Exception {
        String spoofed = ip(), email = unknown();
        var untrusted = HttpClient.newBuilder().localAddress(InetAddress.getByName("127.0.0.2")).build();
        var response = untrusted.send(request(email, "wrong-password", spoofed).build(), HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode()).isEqualTo(401);
        assertThat(count("IP:" + EmailActionTokens.hash(spoofed), "solicitudes")).isZero();
        assertThat(count(pair(email, "127.0.0.2"), "fallos")).isEqualTo(1);
    }

    @Test
    void corsExposesRetryAfterAndPasswordRecoveryDoesNotUseLoginBuckets() throws Exception {
        var account = account(true);
        String ip = ip();
        for (int i = 0; i < 5; i++) assertThat(login(account.email(), "wrong-password", ip).statusCode()).isEqualTo(401);
        var limited = http.send(request(account.email(), PASSWORD, ip).header("Origin", "https://spa.example.invalid").build(), HttpResponse.BodyHandlers.ofString());
        assertLimited(limited);
        assertThat(limited.headers().firstValue("Access-Control-Expose-Headers").orElseThrow()).contains("Retry-After");
        var reset = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/api/v1/auth/forgot-password"))
                .header("Content-Type", "application/json").header("X-Forwarded-For", ip)
                .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(Map.of("email", account.email())))).build();
        assertThat(http.send(reset, HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(202);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM pliego.correo_token WHERE usuario_id=? AND tipo='RESET_PASSWORD'", Integer.class, account.id())).isEqualTo(1);
    }

    @Test
    void maintenanceCommitsBoundedCleanupThroughSpringProxy() {
        String key = "IP:" + EmailActionTokens.hash(UUID.randomUUID().toString());
        jdbc.update("INSERT INTO pliego.login_intento_limite(clave,expira,solicitudes) VALUES (?,clock_timestamp()-INTERVAL '1 minute',1)", key);
        assertThat(maintenance.cleanup()).isBetween(1, 1000);
        assertThat(count(key, "solicitudes")).isZero();
    }

    private void assertLimited(HttpResponse<String> response) throws Exception {
        assertThat(response.statusCode()).isEqualTo(429);
        assertThat(response.headers().firstValue("Content-Type").orElseThrow()).contains("application/problem+json");
        assertThat(Integer.parseInt(response.headers().firstValue("Retry-After").orElseThrow())).isBetween(1, 3600);
        assertThat(response.headers().allValues("Set-Cookie")).isEmpty();
        var body = json.readTree(response.body());
        assertThat(body.get("code").asString()).isEqualTo("AUTH_LOGIN_RATE_LIMITED");
        assertThat(body.get("title").asString()).isEqualTo("Demasiados intentos");
        assertThat(body.get("detail").asString()).isEqualTo("Espera unos minutos antes de volver a intentarlo.");
        assertThat(body.get("status").asInt()).isEqualTo(429);
    }

    private HttpResponse<String> login(String email, String password, String ip) throws Exception {
        return http.send(request(email, password, ip).build(), HttpResponse.BodyHandlers.ofString());
    }

    private HttpRequest.Builder request(String email, String password, String ip) throws Exception {
        var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/api/v1/auth/login"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(Map.of("email", email, "password", password))));
        return ip == null ? request : request.header("X-Forwarded-For", ip);
    }

    private Account account(boolean verified) {
        String email = unknown();
        Long id = jdbc.queryForObject("INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado,email_verificado_en) VALUES (?,?,'CUSTOMER','ACTIVE',CASE WHEN ? THEN clock_timestamp() ELSE NULL END) RETURNING usuario_id", Long.class, email, passwords.encode(PASSWORD), verified);
        jdbc.update("INSERT INTO pliego.cliente(usuario_id,nombres,apellidos) VALUES (?,'Cliente','Prueba')", id);
        return new Account(id, email);
    }

    private int count(String key, String column) {
        // Only test-owned constant column names reach this helper.
        return jdbc.queryForObject("SELECT COALESCE((SELECT " + column + " FROM pliego.login_intento_limite WHERE clave=?),0)", Integer.class, key);
    }

    private static String unknown() { return "ppa05-" + UUID.randomUUID() + "@example.invalid"; }
    private static String ip() { return "2001:db8:" + UUID.randomUUID().toString().replace("-", "").substring(0, 4) + ":" + UUID.randomUUID().toString().replace("-", "").substring(0, 4) + "::1"; }
    private static String pair(String email, String ip) { return "AP:" + EmailActionTokens.hash(EmailActionTokens.hash(email.toLowerCase(java.util.Locale.ROOT)) + ":" + EmailActionTokens.hash(ip)); }
    private static String key(String scope, String email, String ip) { return scope.equals("AP") ? pair(email, ip) : scope + ":" + EmailActionTokens.hash(scope.equals("IP") ? ip : email); }
    private record Account(long id, String email) { }
}
