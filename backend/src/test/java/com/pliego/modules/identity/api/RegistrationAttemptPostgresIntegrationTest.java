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
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
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
import com.pliego.modules.identity.gateway.RegistrationContinuationGateway;
import com.pliego.modules.identity.gateway.JdbcIdentityGateway;
import tools.jackson.databind.ObjectMapper;

/** Actual HTTP, trusted-proxy resolution, BCrypt and independently committed PG18 admission. */
@EnabledIfEnvironmentVariable(named = "PLIEGO_TEST_DISPOSABLE_DB", matches = "1")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "pliego.mail.enabled=false", "pliego.billing.enabled=false",
        "pliego.home-delivery.scheduler-enabled=false", "server.address=127.0.0.1",
        "spring.datasource.hikari.maximum-pool-size=8",
        "pliego.cors.allowed-origins=https://spa.example.invalid"
})
class RegistrationAttemptPostgresIntegrationTest {
    @LocalServerPort int port;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;
    @Autowired com.pliego.modules.identity.application.EmailActionTokens tokens;
    @Autowired com.pliego.modules.identity.application.RegistrationAttemptMaintenance maintenance;
    @MockitoSpyBean PasswordEncoder passwords;
    @MockitoSpyBean RegistrationContinuationGateway continuations;
    @MockitoSpyBean JdbcIdentityGateway identities;
    private final HttpClient http = HttpClient.newHttpClient();
    private static final String PASSWORD = "test-only-registration-password-123";

    @BeforeAll
    static void requireDisposableLoopbackDatabase() {
        assertThat(System.getenv("PGHOST")).isEqualTo("127.0.0.1");
        assertThat(System.getenv("PLIEGO_DB_URL")).startsWith("jdbc:postgresql://127.0.0.1:");
    }

    @Test
    void newDuplicateAndTheirPendingContinuationsHaveSameShapeWithoutAccountMutation() throws Exception {
        String email = email(), ip = ip();
        clearInvocations(passwords);
        var fresh = register(email, ip);
        assertNeutral(fresh);
        long actor = actor(email);
        String originalHash = jdbc.queryForObject("SELECT password_hash FROM pliego.usuario WHERE usuario_id=?", String.class, actor);
        String originalToken = jdbc.queryForObject("SELECT token_hash FROM pliego.correo_token WHERE usuario_id=?", String.class, actor);
        var duplicate = register(email.toUpperCase(java.util.Locale.ROOT), ip);
        assertNeutral(duplicate);
        assertThat(duplicate.body()).isEqualTo(fresh.body());
        assertThat(cookieShape(duplicate)).isEqualTo(cookieShape(fresh));
        verify(passwords, times(2)).encode(PASSWORD);
        assertThat(jdbc.queryForObject("SELECT password_hash FROM pliego.usuario WHERE usuario_id=?", String.class, actor)).isEqualTo(originalHash);
        assertThat(jdbc.queryForObject("SELECT token_hash FROM pliego.correo_token WHERE usuario_id=?", String.class, actor)).isEqualTo(originalToken);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM pliego.correo_outbox WHERE usuario_id=?", Integer.class, actor)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM pliego.registro_continuacion WHERE usuario_id=?", Integer.class, actor)).isEqualTo(1);
        assertThat(exchange(fresh, ip).body()).isEqualTo(exchange(duplicate, ip).body()).isEqualTo("{\"state\":\"PENDING_VERIFICATION\"}");
        // Even after the victim proves their email, the duplicate receipt never gains access.
        jdbc.update("UPDATE pliego.usuario SET email_verificado_en=clock_timestamp() WHERE usuario_id=?", actor);
        assertThat(exchange(duplicate, ip).body()).isEqualTo("{\"state\":\"PENDING_VERIFICATION\"}");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM pliego.sesion_autenticacion WHERE usuario_id=?", Integer.class, actor)).isZero();
        assertThat(exchange(fresh, ip).statusCode()).isEqualTo(200);
    }

    @Test
    @ExtendWith(OutputCaptureExtension.class)
    void fiveAttemptsThenSpanish429SkipsBcryptAndAccountLookupAndLogsNoIdentifiers(CapturedOutput output) throws Exception {
        String email = email(), ip = ip();
        for (int n=0;n<5;n++) assertNeutral(register(email, ip));
        clearInvocations(passwords, identities);
        var limited = register(email, ip);
        assertLimited(limited);
        verify(passwords, never()).encode(any());
        verify(identities, never()).register(any(), any(), any(), any(), any(), any(), any());
        assertThat(count("AC:" + EmailActionTokens.hash(email), "solicitudes")).isEqualTo(6);
        assertThat(count("IP:" + EmailActionTokens.hash(ip), "admitidos")).isEqualTo(5);
        assertThat(output.getAll()).contains("registration_attempt state=LIMITED code=AUTH_REGISTER_RATE_LIMITED retry_after_seconds=")
                .doesNotContain(email, ip, PASSWORD, EmailActionTokens.hash(email), EmailActionTokens.hash(ip));
    }

    @ParameterizedTest
    @ValueSource(strings = {"IP", "AC"})
    void exhaustedScopesAreNeutralForKnownUnknownAndRecoverAfterExpiry(String scope) throws Exception {
        String email = email(), ip = ip();
        assertNeutral(register(email, ip));
        String key = scope + ":" + EmailActionTokens.hash(scope.equals("IP") ? ip : email);
        jdbc.update("UPDATE pliego.registro_intento_limite SET solicitudes=?,admitidos=? WHERE clave=?", scope.equals("IP") ? 120 : 5, scope.equals("IP") ? 120 : 5, key);
        clearInvocations(passwords);
        assertLimited(register(email.toUpperCase(java.util.Locale.ROOT), ip));
        if (scope.equals("IP")) assertLimited(register(email(), ip));
        else assertLimited(register(email, ip()));
        verify(passwords, never()).encode(any());
        jdbc.update("UPDATE pliego.registro_intento_limite SET expira=clock_timestamp()-INTERVAL '1 second' WHERE clave=?", key);
        assertNeutral(register(email, ip));
        assertThat(count(key, "admitidos")).isEqualTo(1);
    }

    @ParameterizedTest
    @ValueSource(strings={"CUSTOMER:ACTIVE", "CUSTOMER:BLOCKED", "ADMIN:ACTIVE"})
    void existingVerifiedBlockedAndAdminAccountsRemainNeutralAndNeverGetAContinuation(String kind) throws Exception {
        String email=email(), ip=ip();
        String[] values=kind.split(":");
        long actor=jdbc.queryForObject("INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado,email_verificado_en) VALUES (?,'unchanged-fixture-hash',?,?,clock_timestamp()) RETURNING usuario_id",Long.class,email,values[0],values[1]);
        var response=register(email,ip);
        assertNeutral(response);
        assertThat(exchange(response,ip).body()).isEqualTo("{\"state\":\"PENDING_VERIFICATION\"}");
        assertThat(jdbc.queryForObject("SELECT password_hash FROM pliego.usuario WHERE usuario_id=?",String.class,actor)).isEqualTo("unchanged-fixture-hash");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM pliego.registro_continuacion WHERE usuario_id=?",Integer.class,actor)).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM pliego.correo_outbox WHERE usuario_id=?",Integer.class,actor)).isZero();
    }

    @Test
    void concurrentSameEmailAcrossIpsAdmitsFiveAndCreatesOnlyOneAccountAndMessage() throws Exception {
        String email=email();
        clearInvocations(passwords);
        try(var workers=Executors.newFixedThreadPool(8)) {
            var requests=new ArrayList<java.util.concurrent.Future<HttpResponse<String>>>();
            for(int n=0;n<8;n++)requests.add(workers.submit(() -> register(email,ip())));
            int accepted=0, limited=0;
            for(var request:requests) {
                var response=request.get(30,TimeUnit.SECONDS);
                if(response.statusCode()==201) {assertNeutral(response);accepted++;}
                else {assertLimited(response);limited++;}
            }
            assertThat(accepted).isEqualTo(5);
            assertThat(limited).isEqualTo(3);
        }
        verify(passwords,times(5)).encode(PASSWORD);
        long actor=actor(email);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM pliego.correo_outbox WHERE usuario_id=?",Integer.class,actor)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM pliego.registro_continuacion WHERE usuario_id=?",Integer.class,actor)).isEqualTo(1);
        assertThat(count("AC:"+EmailActionTokens.hash(email),"admitidos")).isEqualTo(5);
    }

    @Test
    void maintenanceUsesSeparateSpringTransactionsToCleanExpiredBucketsAndNeutralReceipts() {
        String hash=EmailActionTokens.hash(UUID.randomUUID().toString());
        jdbc.update("INSERT INTO pliego.registro_intento_limite(clave,expira,solicitudes) VALUES (?,clock_timestamp()-INTERVAL '1 minute',1)","IP:"+hash);
        jdbc.update("INSERT INTO pliego.registro_continuacion_neutral(token_hash,expira) VALUES (?,clock_timestamp()-INTERVAL '1 minute')",hash);
        assertThat(maintenance.cleanup()).isBetween(1,1000);
        assertThat(maintenance.cleanupNeutralReceipts()).isBetween(1,1000);
        assertThat(count("IP:"+hash,"solicitudes")).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM pliego.registro_continuacion_neutral WHERE token_hash=?",Integer.class,hash)).isZero();
    }

    @Test
    void neutralAndRealReceiptsExpireAndLogoutTogetherWithoutGrantingAccess() throws Exception {
        String email=email(),ip=ip();
        var fresh=register(email,ip);
        var duplicate=register(email,ip);
        long actor=actor(email);
        jdbc.update("UPDATE pliego.registro_continuacion SET fecha_creacion=clock_timestamp()-INTERVAL '2 hours',fecha_expiracion=clock_timestamp()-INTERVAL '1 hour' WHERE usuario_id=?",actor);
        String hash=EmailActionTokens.hash(cookie(duplicate).split("=",2)[1]);
        jdbc.update("UPDATE pliego.registro_continuacion_neutral SET expira=clock_timestamp()-INTERVAL '1 hour' WHERE token_hash=?",hash);
        assertThat(exchange(fresh,ip).statusCode()).isEqualTo(204);
        assertThat(exchange(duplicate,ip).statusCode()).isEqualTo(204);
        var replacement=register(email,ip);
        assertThat(post("logout",null,ip,cookie(replacement)).statusCode()).isEqualTo(204);
        assertThat(exchange(replacement,ip).statusCode()).isEqualTo(204);
    }

    @Test
    void validationRejectsBeforeHashAndDoesNotCreateQuotaOrAccount() throws Exception {
        String email=email(), ip=ip();
        clearInvocations(passwords);
        var response=http.send(request(email, ip, "short").build(), HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode()).isEqualTo(400);
        verify(passwords, never()).encode(any());
        assertThat(count("IP:"+EmailActionTokens.hash(ip), "solicitudes")).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM pliego.usuario WHERE email_normalizado=?", Integer.class, email)).isZero();
    }

    @Test
    void infrastructureFailureRollsBackAccountButKeepsAdmissionCommitted() throws Exception {
        String email=email(), ip=ip();
        org.mockito.Mockito.doThrow(new IllegalStateException("Fallo de infraestructura de prueba"))
                .when(continuations).issue(org.mockito.ArgumentMatchers.anyLong(), any(), any());
        try { assertThat(register(email,ip).statusCode()).isEqualTo(500); }
        finally { org.mockito.Mockito.doCallRealMethod().when(continuations).issue(org.mockito.ArgumentMatchers.anyLong(), any(), any()); }
        assertThat(jdbc.queryForObject("SELECT count(*) FROM pliego.usuario WHERE email_normalizado=?", Integer.class, email)).isZero();
        assertThat(count("IP:"+EmailActionTokens.hash(ip), "admitidos")).isEqualTo(1);
        assertThat(count("AC:"+EmailActionTokens.hash(email), "admitidos")).isEqualTo(1);
    }

    @Test
    void eightAccountsBehindNatReachBcryptBeforeAnyVerifierIsReleased() throws Exception {
        String ip=ip();
        var emails=new ArrayList<String>();
        for(int n=0;n<8;n++) emails.add(email());
        var entered=new CountDownLatch(8);
        var release=new CountDownLatch(1);
        org.mockito.Mockito.doAnswer(call -> {
            entered.countDown();
            if(!release.await(20, TimeUnit.SECONDS)) throw new AssertionError("BCrypt barrier timed out");
            return call.callRealMethod();
        }).when(passwords).encode(PASSWORD);
        try(var workers=Executors.newFixedThreadPool(8)) {
            var requests=emails.stream().map(email -> workers.submit(() -> register(email, ip))).toList();
            try {
                assertThat(entered.await(10, TimeUnit.SECONDS)).as("all eight independent registrations enter BCrypt").isTrue();
                try(var observer=DriverManager.getConnection(System.getenv("PLIEGO_DB_URL"),System.getenv("PLIEGO_DB_USERNAME"),System.getenv("PLIEGO_DB_PASSWORD"))) {
                    observer.setAutoCommit(false);
                    try(var statement=observer.prepareStatement("SELECT admitidos FROM pliego.registro_intento_limite WHERE clave=? FOR UPDATE NOWAIT")) {
                        statement.setString(1,"IP:"+EmailActionTokens.hash(ip));
                        try(var rows=statement.executeQuery()) { assertThat(rows.next()).isTrue(); assertThat(rows.getInt(1)).isEqualTo(8); }
                    } finally { observer.rollback(); }
                }
            } finally { release.countDown(); }
            for(var response:requests) assertNeutral(response.get(30,TimeUnit.SECONDS));
        } finally { release.countDown(); org.mockito.Mockito.doCallRealMethod().when(passwords).encode(any()); }
    }

    @Test
    void tomcatUsesRightmostUntrustedHopAndIgnoresSpoofedHeadersFromUntrustedPeer() throws Exception {
        String real=ip(), spoofed=ip(), email=email();
        var response=http.send(request(email,spoofed+", "+real,PASSWORD).build(),HttpResponse.BodyHandlers.ofString());
        assertNeutral(response);
        assertThat(count("IP:"+EmailActionTokens.hash(real),"solicitudes")).isEqualTo(1);
        assertThat(count("IP:"+EmailActionTokens.hash(spoofed),"solicitudes")).isZero();
        var untrusted=HttpClient.newBuilder().localAddress(InetAddress.getByName("127.0.0.2")).build();
        assertNeutral(untrusted.send(request(email(),spoofed,PASSWORD).build(),HttpResponse.BodyHandlers.ofString()));
        assertThat(count("IP:"+EmailActionTokens.hash(spoofed),"solicitudes")).isZero();
        assertThat(count("IP:"+EmailActionTokens.hash("127.0.0.2"),"solicitudes")).isPositive();
        jdbc.update("UPDATE pliego.registro_intento_limite SET solicitudes=120,admitidos=120 WHERE clave IN (?,?)", "IP:"+EmailActionTokens.hash(real),"IP:"+EmailActionTokens.hash("127.0.0.2"));
        assertLimited(http.send(request(email(),ip()+", "+real,PASSWORD).build(),HttpResponse.BodyHandlers.ofString()));
        assertLimited(untrusted.send(request(email(),ip(),PASSWORD).build(),HttpResponse.BodyHandlers.ofString()));
    }

    @Test
    void recoveryAndResendKeepExistingNeutral202AndIndependentQuotas() throws Exception {
        String email=email(), ip=ip();
        var original=register(email,ip);
        long actor=actor(email);
        jdbc.update("UPDATE pliego.registro_intento_limite SET solicitudes=120,admitidos=120 WHERE clave=?", "IP:"+EmailActionTokens.hash(ip));
        assertLimited(register(email(),ip));
        for(String endpoint:new String[]{"resend-verification", "forgot-password"}) {
            for(String target:new String[]{email,email()}) {
                assertThat(post(endpoint,Map.of("email",target),ip,null).statusCode()).isEqualTo(202);
            }
        }
        jdbc.update("UPDATE pliego.usuario SET email_verificado_en=clock_timestamp() WHERE usuario_id=?",actor);
        assertThat(post("forgot-password",Map.of("email",email),ip,null).statusCode()).isEqualTo(202);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM pliego.correo_token WHERE usuario_id=? AND tipo='RESET_PASSWORD'",Integer.class,actor)).isEqualTo(1);
        // The neutral receipt remains independent of issuance/recovery delivery quotas.
        assertThat(exchange(original,ip).statusCode()).isEqualTo(200);
        String nonce=jdbc.queryForObject("SELECT datos->>'nonce' FROM pliego.correo_outbox WHERE usuario_id=? AND tipo='RESET_PASSWORD' ORDER BY correo_id DESC LIMIT 1",String.class,actor);
        String reset=tokens.derive("RESET_PASSWORD",nonce);
        assertThat(post("reset-password",Map.of("token",reset,"password","Recovered-password-123"),ip,null).statusCode()).isEqualTo(204);
        assertThat(post("reset-password",Map.of("token",reset,"password","Recovered-password-123"),ip,null).statusCode()).isEqualTo(400);
        assertLimited(register(email,ip));
        assertThat(post("login",Map.of("email",email,"password","Recovered-password-123"),ip,null).statusCode()).isEqualTo(200);
    }

    private void assertNeutral(HttpResponse<String> response) throws Exception {
        assertThat(response.statusCode()).isEqualTo(201);
        assertThat(json.readTree(response.body()).properties()).hasSize(1);
        assertThat(json.readTree(response.body()).get("state").asString()).isEqualTo("PENDING_VERIFICATION");
        assertThat(response.headers().allValues("Set-Cookie")).singleElement().asString()
                .matches("pliego_registration=[A-Za-z0-9_-]{43};.*").contains("HttpOnly", "SameSite=Strict", "Secure", "Max-Age=86400");
    }

    private void assertLimited(HttpResponse<String> response) throws Exception {
        assertThat(response.statusCode()).isEqualTo(429);
        assertThat(response.headers().firstValue("Content-Type").orElseThrow()).contains("application/problem+json");
        assertThat(Integer.parseInt(response.headers().firstValue("Retry-After").orElseThrow())).isBetween(1,3600);
        assertThat(response.headers().allValues("Set-Cookie")).isEmpty();
        var body=json.readTree(response.body());
        assertThat(body.get("code").asString()).isEqualTo("AUTH_REGISTER_RATE_LIMITED");
        assertThat(body.get("title").asString()).isEqualTo("Demasiados intentos");
        assertThat(body.get("detail").asString()).isEqualTo("Espera unos minutos antes de volver a intentarlo.");
        assertThat(body.get("traceId").asString()).isNotEmpty();
    }

    private String cookie(HttpResponse<String> response) { return response.headers().firstValue("Set-Cookie").orElseThrow().split(";",2)[0]; }
    private String cookieShape(HttpResponse<String> response) { return response.headers().firstValue("Set-Cookie").orElseThrow().replaceFirst("=[A-Za-z0-9_-]{43}", "=REDACTED").replaceAll("Expires=[^;]*", "Expires=DATE"); }
    private HttpResponse<String> exchange(HttpResponse<String> registration,String ip) throws Exception { return post("registration-session",null,ip,cookie(registration)); }
    private HttpResponse<String> register(String email,String ip) throws Exception { return http.send(request(email,ip,PASSWORD).build(),HttpResponse.BodyHandlers.ofString()); }
    private HttpRequest.Builder request(String email,String ip,String password) throws Exception {
        return HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+"/api/v1/auth/register"))
                .header("Content-Type","application/json").header("X-Forwarded-For",ip)
                .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(Map.of("email",email,"password",password,"firstNames","Cliente","lastNames","Registro"))));
    }
    private HttpResponse<String> post(String endpoint,Object body,String ip,String cookie) throws Exception {
        var builder=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+"/api/v1/auth/"+endpoint))
                .header("Content-Type","application/json").header("X-Forwarded-For",ip).header("X-PLIEGO-SESSION-REQUEST","1")
                .POST(HttpRequest.BodyPublishers.ofString(body==null?"":json.writeValueAsString(body)));
        if(cookie!=null)builder.header("Cookie",cookie);
        return http.send(builder.build(),HttpResponse.BodyHandlers.ofString());
    }
    private long actor(String email) { return jdbc.queryForObject("SELECT usuario_id FROM pliego.usuario WHERE email_normalizado=?",Long.class,email); }
    private int count(String key,String column) { return jdbc.queryForObject("SELECT COALESCE((SELECT "+column+" FROM pliego.registro_intento_limite WHERE clave=?),0)",Integer.class,key); }
    private static String email() { return "reg-"+UUID.randomUUID()+"@example.invalid"; }
    private static String ip() { return "2001:db8:"+UUID.randomUUID().toString().substring(0,4)+":"+UUID.randomUUID().toString().substring(0,4)+"::1"; }
}
