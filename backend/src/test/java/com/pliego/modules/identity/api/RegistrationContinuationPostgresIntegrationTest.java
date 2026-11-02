package com.pliego.modules.identity.api;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import com.pliego.modules.identity.application.EmailActionTokens;
import tools.jackson.databind.ObjectMapper;

/** Opt-in HTTP/Tomcat/JDBC coverage; only the disposable PostgreSQL gate environment may run it. */
@EnabledIfEnvironmentVariable(named = "PLIEGO_TEST_DISPOSABLE_DB", matches = "1")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "pliego.mail.enabled=false", "pliego.billing.enabled=false",
        "pliego.cors.allowed-origins=https://spa.example.invalid",
        "logging.level.org.springframework.security.web.firewall=DEBUG",
        "pliego.home-delivery.scheduler-enabled=false", "server.address=127.0.0.1"
})
class RegistrationContinuationPostgresIntegrationTest {
    @LocalServerPort int port;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;
    @Autowired EmailActionTokens tokens;
    private final HttpClient http = HttpClient.newHttpClient();

    @BeforeAll
    static void requireDisposableLoopbackDatabase() {
        assertThat(System.getenv("PGHOST")).isEqualTo("127.0.0.1");
        assertThat(System.getenv("PLIEGO_DB_URL")).startsWith("jdbc:postgresql://127.0.0.1:");
    }

    @ParameterizedTest
    @CsvSource({"REGIP,true", "REG,true", "REGIP,false", "REG,false"})
    void exchangeExhaustedBucketRetainsCookieAndSucceedsAfterWindowReset(String bucket, boolean verified) throws Exception {
        var fixture = register();
        if (verified) assertThat(verify(fixture, false).statusCode()).isEqualTo(204);
        String ip = "198.51.100.41";
        String key = bucket + ":" + EmailActionTokens.hash(bucket.equals("REGIP") ? ip : fixture.secret());
        exhaust(key, bucket.equals("REGIP") ? 1200 : 600);
        try {
            var limited = exchange(fixture, ip);
            assertThat(limited.statusCode()).isEqualTo(202);
            assertThat(json.readTree(limited.body()).get("state").asString()).isEqualTo("RETRY_LATER");
            assertThat(limited.headers().allValues("Set-Cookie")).isEmpty();
            assertThat(Integer.parseInt(limited.headers().firstValue("Retry-After").orElseThrow()))
                    .isBetween(1, 3600);
            assertUnconsumed(fixture);
            resetWindow(key);
            if (!verified) {
                var pending = exchange(fixture, ip);
                assertThat(pending.statusCode()).isEqualTo(202);
                assertThat(json.readTree(pending.body()).get("state").asString()).isEqualTo("PENDING_VERIFICATION");
                assertThat(pending.headers().allValues("Set-Cookie")).isEmpty();
                assertThat(verify(fixture, false).statusCode()).isEqualTo(204);
            }
            var success = exchange(fixture, ip);
            assertThat(success.statusCode()).isEqualTo(200);
            assertThat(json.readTree(success.body()).get("user").get("userId").asString())
                    .isEqualTo(Long.toString(fixture.actor()));
            assertThat(success.headers().allValues("Set-Cookie")).anyMatch(value -> value.startsWith("pliego_session="));
            assertThat(success.headers().allValues("Set-Cookie")).anyMatch(value ->
                    value.startsWith("pliego_registration=") && value.contains("Max-Age=0"));
            assertThat(sessionCount(fixture)).isEqualTo(1);
        } finally {
            jdbc.update("DELETE FROM pliego.registro_continuacion_limite WHERE clave=?", key);
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"absent", "unknown", "malformed", "expired", "consumed"})
    void invalidContinuationStillClearsCookieEvenWithExhaustedIp(String kind) throws Exception {
        var fixture = register();
        String ip = "198.51.100.42";
        if (kind.equals("expired")) {
            jdbc.update("UPDATE pliego.registro_continuacion SET fecha_creacion=clock_timestamp()-INTERVAL '2 hours',fecha_expiracion=clock_timestamp()-INTERVAL '1 hour' WHERE usuario_id=?", fixture.actor());
        } else if (kind.equals("consumed")) {
            assertThat(verify(fixture, false).statusCode()).isEqualTo(204);
            assertThat(exchange(fixture, ip).statusCode()).isEqualTo(200);
            jdbc.update("UPDATE pliego.registro_continuacion SET fecha_uso=clock_timestamp()-INTERVAL '6 minutes' WHERE usuario_id=?", fixture.actor());
        }
        String supplied = switch (kind) {
            case "absent" -> null;
            case "unknown" -> "pliego_registration=" + "Z".repeat(43);
            case "malformed" -> "pliego_registration=bad";
            default -> fixture.cookie();
        };
        String key = "REGIP:" + EmailActionTokens.hash(ip);
        exhaust(key, 1200);
        try {
            var response = post("/registration-session", null, supplied, ip);
            assertThat(response.statusCode()).isEqualTo(204);
            assertThat(response.body()).isEmpty();
            assertThat(response.headers().allValues("Set-Cookie")).singleElement()
                    .asString().startsWith("pliego_registration=").contains("Max-Age=0");
        } finally {
            jdbc.update("DELETE FROM pliego.registro_continuacion_limite WHERE clave=?", key);
        }
    }

    @Test
    void verifyEmailExhaustedIpStillVerifiesAndRetainsContinuation() throws Exception {
        var fixture = register();
        String key = "REGIP:" + EmailActionTokens.hash("127.0.0.1");
        exhaust(key, 1200);
        try {
            var verified = verify(fixture, true);
            assertThat(verified.statusCode()).isEqualTo(204);
            assertThat(verified.body()).isEmpty();
            assertThat(verified.headers().allValues("Set-Cookie")).isEmpty();
            assertThat(jdbc.queryForObject("SELECT email_verificado_en IS NOT NULL FROM pliego.usuario WHERE usuario_id=?",
                    Boolean.class, fixture.actor())).isTrue();
            assertUnconsumed(fixture);
            var limited = exchange(fixture, null);
            assertThat(limited.statusCode()).isEqualTo(202);
            assertThat(json.readTree(limited.body()).get("state").asString()).isEqualTo("RETRY_LATER");
            assertThat(limited.headers().allValues("Set-Cookie")).isEmpty();
            resetWindow(key);
            assertThat(exchange(fixture, null).statusCode()).isEqualTo(200);
            assertThat(sessionCount(fixture)).isEqualTo(1);
        } finally {
            jdbc.update("DELETE FROM pliego.registro_continuacion_limite WHERE clave=?", key);
        }
    }

    @ParameterizedTest
    @CsvSource(value = {
            "198.51.100.12;198.51.100.12",
            "203.0.113.99, 198.51.100.12;198.51.100.12",
            "203.0.113.99, 10.0.0.12;10.0.0.12",
            "203.0.113.99, 192.168.0.12;192.168.0.12",
            "203.0.113.99, 172.16.0.12;172.16.0.12"
    }, delimiter = ';')
    void loopbackProxyUsesRightmostUntrustedAddressForBucket(String forwarded, String expected) throws Exception {
        var fixture = register();
        String key = "REGIP:" + EmailActionTokens.hash(expected);
        Integer before = bucketCount(key);
        Integer spoofBefore = bucketCount("REGIP:" + EmailActionTokens.hash("203.0.113.99"));
        var response = exchange(fixture, forwarded);
        assertThat(response.statusCode()).isEqualTo(202);
        assertThat(bucketCount(key)).isEqualTo(before + 1);
        assertThat(bucketCount("REGIP:" + EmailActionTokens.hash("203.0.113.99"))).isEqualTo(spoofBefore);
    }

    @Test
    void withoutForwardedHeaderUsesSocketAddressForBucket() throws Exception {
        var fixture = register();
        String key = "REGIP:" + EmailActionTokens.hash("127.0.0.1");
        int before = bucketCount(key);
        assertThat(exchange(fixture, null).statusCode()).isEqualTo(202);
        assertThat(bucketCount(key)).isEqualTo(before + 1);
    }

    static Stream<Arguments> sessionPaths() {
        return Stream.of("registration-session", "verify-email", "refresh", "logout")
                .flatMap(route -> Stream.concat(Stream.of(route,
                        "%" + Integer.toHexString(route.charAt(0)) + route.substring(1),
                        route.replace("e", "%65"), route.replace("o", "%6f").replace("i", "%69"),
                        route.chars().mapToObj(c -> "%%%02X".formatted(c)).collect(java.util.stream.Collectors.joining()))
                        .distinct().map(alias -> "/api/v1/auth/" + alias), Stream.of("/api/v1/%61uth/" + route))
                        .map(path -> Arguments.of(route, path)));
    }

    @ParameterizedTest
    @MethodSource("sessionPaths")
    void dispatchedSessionAliasesRequireMarkerAndPreserveSuccess(String route, String path) throws Exception {
        var fixture = register();
        String cookie = fixture.cookie();
        if (!route.equals("verify-email")) {
            var verified = verify(fixture, route.equals("refresh") || route.equals("logout"));
            assertThat(verified.statusCode()).isEqualTo(route.equals("registration-session") ? 204 : 200);
            if (!route.equals("registration-session")) cookie = sessionCookie(verified);
        }
        Map<String, String> body = route.equals("verify-email") ? Map.of("token", fixture.token()) : null;
        var denied = postAbsolute(path, body, cookie, false, null);
        assertThat(denied.statusCode()).as("missing marker: %s", path).isEqualTo(403);
        assertThat(json.readTree(denied.body()).get("code").asString()).isEqualTo("ACCESS_DENIED");
        assertThat(denied.headers().allValues("Set-Cookie")).isEmpty();
        var success = postAbsolute(path, body, cookie, true, null);
        assertThat(success.statusCode()).as("marker present: %s", path).isEqualTo(route.equals("logout") ? 204 : 200);
        if (!route.equals("logout")) {
            assertThat(sessionCookie(success)).startsWith("pliego_session=");
            assertThat(sessionCount(fixture)).isEqualTo(1);
        }
    }

    static Stream<Arguments> rejectedSessionPaths() {
        return Stream.of("registration-session", "verify-email", "refresh", "logout").flatMap(route -> Stream.of(
                Arguments.of("/api/v1/auth/" + route + ";jsessionid=test", true),
                Arguments.of("/api/v1/auth;param=test/" + route, true),
                Arguments.of("/api/v1/auth/" + route + "%3Bjsessionid=test", true),
                Arguments.of("/api/v1/auth//" + route, true),
                Arguments.of("/api//v1/auth/" + route, true),
                Arguments.of("/api/v1/auth/%25" + Integer.toHexString(route.charAt(0)) + route.substring(1), true),
                Arguments.of("/api/v1/auth/" + route + "/", false),
                Arguments.of("/api/v1/auth/" + route.toUpperCase(java.util.Locale.ROOT), false)));
    }

    @ParameterizedTest
    @MethodSource("rejectedSessionPaths")
    @ExtendWith(OutputCaptureExtension.class)
    void firewallAndExactRoutesRejectNonDispatchableVariants(String path, boolean firewall, CapturedOutput output) throws Exception {
        // StrictHttpFirewall sends 400 for ambiguous paths; Tomcat's ERROR
        // dispatch reaches the protected /error endpoint and yields native 401.
        for (boolean marker : new boolean[] {false, true}) {
            var response = postAbsolute(path, Map.of("token", "unused"), "pliego_registration=unused", marker, null);
            assertThat(response.statusCode()).as("%s marker=%s", path, marker).isEqualTo(401);
            assertThat(response.headers().allValues("Set-Cookie")).isEmpty();
        }
        if (firewall) assertThat(output.getAll()).contains("Rejecting request due to:", "StrictHttpFirewall");
        else assertThat(output.getAll()).doesNotContain("Rejecting request due to:");
    }

    @Test
    void crossOriginRetryResponseExposesRetryAfter() throws Exception {
        var fixture = register();
        String key = "REGIP:" + EmailActionTokens.hash("127.0.0.1");
        exhaust(key, 1200);
        try {
            var response = postAbsolute("/api/v1/auth/registration-session", null, fixture.cookie(), true,
                    "https://spa.example.invalid");
            assertThat(response.statusCode()).isEqualTo(202);
            assertThat(response.headers().firstValue("Access-Control-Allow-Origin")).contains("https://spa.example.invalid");
            assertThat(response.headers().firstValue("Access-Control-Allow-Credentials")).contains("true");
            assertThat(response.headers().firstValue("Retry-After")).isPresent();
            assertThat(response.headers().allValues("Access-Control-Expose-Headers").stream()
                    .flatMap(value -> java.util.Arrays.stream(value.split(","))).map(String::trim))
                    .contains("Retry-After", "X-Trace-Id");
        } finally {
            jdbc.update("DELETE FROM pliego.registro_continuacion_limite WHERE clave=?", key);
        }
    }

    private String sessionCookie(HttpResponse<String> response) {
        return response.headers().allValues("Set-Cookie").stream().filter(value -> value.startsWith("pliego_session="))
                .findFirst().orElseThrow().split(";", 2)[0];
    }

    private HttpResponse<String> postAbsolute(String path, Map<String, String> body, String cookie,
            boolean marker, String origin) throws Exception {
        var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path))
                .header("Content-Type", "application/json")
                .POST(body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)));
        if (marker) request.header("X-PLIEGO-SESSION-REQUEST", "1");
        if (cookie != null) request.header("Cookie", cookie);
        if (origin != null) request.header("Origin", origin);
        return http.send(request.build(), HttpResponse.BodyHandlers.ofString());
    }

    private Fixture register() throws Exception {
        String email = "reg-java-" + UUID.randomUUID() + "@example.invalid";
        var response = post("/register", Map.of("email", email, "password", "test-only-password-123",
                "firstNames", "Ana", "lastNames", "Pérez", "returnTo", "/checkout"), null, null);
        assertThat(response.statusCode()).isEqualTo(201);
        long actor = Long.parseLong(json.readTree(response.body()).get("userId").asString());
        String cookie = response.headers().allValues("Set-Cookie").stream()
                .filter(value -> value.startsWith("pliego_registration=")).findFirst().orElseThrow().split(";", 2)[0];
        String nonce = jdbc.queryForObject("SELECT datos->>'nonce' FROM pliego.correo_outbox WHERE usuario_id=? AND tipo='VERIFY_EMAIL' ORDER BY correo_id DESC LIMIT 1",
                String.class, actor);
        return new Fixture(actor, cookie, tokens.derive("VERIFY_EMAIL", nonce));
    }

    private HttpResponse<String> exchange(Fixture fixture, String forwarded) throws Exception {
        return post("/registration-session", null, fixture.cookie(), forwarded);
    }

    private HttpResponse<String> verify(Fixture fixture, boolean withCookie) throws Exception {
        return post("/verify-email", Map.of("token", fixture.token()), withCookie ? fixture.cookie() : null, null);
    }

    private HttpResponse<String> post(String path, Map<String, String> body, String cookie, String forwarded) throws Exception {
        var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/api/v1/auth" + path))
                .header("Content-Type", "application/json").header("X-PLIEGO-SESSION-REQUEST", "1")
                .POST(body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)));
        if (cookie != null) request.header("Cookie", cookie);
        if (forwarded != null) request.header("X-Forwarded-For", forwarded);
        return http.send(request.build(), HttpResponse.BodyHandlers.ofString());
    }

    private void exhaust(String key, int max) {
        jdbc.update("INSERT INTO pliego.registro_continuacion_limite VALUES (?,clock_timestamp(),?) ON CONFLICT(clave) DO UPDATE SET ventana=clock_timestamp(),solicitudes=EXCLUDED.solicitudes", key, max);
    }

    private void resetWindow(String key) {
        jdbc.update("UPDATE pliego.registro_continuacion_limite SET ventana=clock_timestamp()-INTERVAL '61 minutes' WHERE clave=?", key);
    }

    private int bucketCount(String key) {
        return jdbc.queryForObject("SELECT COALESCE((SELECT solicitudes FROM pliego.registro_continuacion_limite WHERE clave=?),0)", Integer.class, key);
    }

    private int sessionCount(Fixture fixture) {
        return jdbc.queryForObject("SELECT count(*) FROM pliego.sesion_autenticacion WHERE usuario_id=?", Integer.class, fixture.actor());
    }

    private void assertUnconsumed(Fixture fixture) {
        assertThat(sessionCount(fixture)).isZero();
        assertThat(jdbc.queryForObject("SELECT fecha_uso IS NULL AND sesion_id IS NULL FROM pliego.registro_continuacion WHERE usuario_id=?",
                Boolean.class, fixture.actor())).isTrue();
    }

    private record Fixture(long actor, String cookie, String token) {
        String secret() { return cookie.split("=", 2)[1]; }
        @Override public String toString() { return "Fixture[REDACTED]"; }
    }
}
