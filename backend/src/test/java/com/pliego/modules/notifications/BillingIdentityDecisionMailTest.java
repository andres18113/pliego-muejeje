package com.pliego.modules.notifications;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.pliego.modules.identity.application.EmailActionTokens;
import com.pliego.modules.notifications.application.MailProperties;
import com.pliego.modules.notifications.application.MailOutboxService;
import com.pliego.modules.notifications.application.MailOutboxWorker;
import com.pliego.modules.notifications.application.OutboxMail;
import com.pliego.modules.notifications.gateway.MailOutboxGateway;
import com.pliego.modules.notifications.provider.MailtrapMailSender;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import com.pliego.modules.notifications.application.MailTemplates;
import java.net.URI;
import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import tools.jackson.databind.ObjectMapper;

class BillingIdentityDecisionMailTest {
    private final ObjectMapper json = new ObjectMapper();
    private final MailTemplates templates = new MailTemplates(new MailProperties(false, null, null, null, null,
            URI.create("https://pliego.example"), false, Duration.ofSeconds(1), Duration.ofSeconds(2), 1),
            new EmailActionTokens("test-only-0123456789abcdef0123456789abcdef"), json);

    @Test
    void approvalStatesTheNumberNowInUseAndKeepsIssuedInvoicesUnchanged() {
        var mail = templates.render("BILLING_IDENTITY_DECIDED", json.createObjectNode()
                .put("status", "APPROVED").put("identityType", "EC_CEDULA")
                .put("identityNumber", "1710034065").put("actionPath", "/account/identity"));
        assertThat(mail.subject()).isEqualTo("Aprobamos tu corrección de identificación");
        assertThat(mail.text()).contains("Tu cuenta ahora usa la cédula 1710034065.",
                "Las facturas ya emitidas conservan sus datos originales.",
                "Ver identificación: https://pliego.example/account/identity");
        assertThat(mail.html()).contains("https://pliego.example/account/identity");
    }

    @Test
    void approvalSupportsTheFullThirteenDigitRucWithoutCallingItACedula() {
        var mail = templates.render("BILLING_IDENTITY_DECIDED", json.createObjectNode()
                .put("status", "APPROVED").put("identityType", "EC_RUC")
                .put("identityNumber", "0912345675001").put("actionPath", "/account/identity"));
        assertThat(mail.subject()).isEqualTo("Aprobamos tu corrección de identificación");
        assertThat(mail.text()).contains("Tu cuenta ahora usa el RUC 0912345675001.",
                "Las facturas ya emitidas conservan sus datos originales.",
                "Ver identificación: https://pliego.example/account/identity")
                .doesNotContain("la cédula");
        assertThat(mail.html()).contains("el RUC 0912345675001", "https://pliego.example/account/identity");
    }

    @Test
    void rejectionShowsTheDecisionReasonAndEscapesItInHtml() {
        var mail = templates.render("BILLING_IDENTITY_DECIDED", json.createObjectNode()
                .put("status", "REJECTED").put("decisionReason", "No coincide <documento> & registro.")
                .put("actionPath", "/account/identity"));
        assertThat(mail.subject()).isEqualTo("Revisamos tu corrección de identificación");
        assertThat(mail.text()).contains("No aprobamos el cambio solicitado.", "No coincide <documento> & registro.",
                "Ver identificación: https://pliego.example/account/identity");
        assertThat(mail.html()).contains("No coincide &lt;documento&gt; &amp; registro.").doesNotContain("<documento>");
    }

    @Test
    void withdrawalCannotBeRenderedAsAnAdministrativeDecision() {
        assertThatThrownBy(() -> templates.render("BILLING_IDENTITY_DECIDED",
                json.createObjectNode().put("status", "WITHDRAWN")))
                .isInstanceOf(IllegalArgumentException.class);
    }

    /** Covers the real worker -> templates -> sender -> loopback HTTP boundary.
     * SQL gates separately prove the atomic decision/enqueue and database lease rules.
     */
    @ParameterizedTest
    @ValueSource(strings = {"APPROVED", "REJECTED"})
    void workerSendsDecisionThroughRealTransportAndCompletesOnlyItsClaimedLease(String status) throws Exception {
        var data = json.createObjectNode().put("requestId", "55").put("status", status)
                .put("decidedAt", "2026-11-03T14:00:00Z").put("actionPath", "/account/identity");
        if (status.equals("APPROVED")) data.put("identityType", "EC_CEDULA").put("identityNumber", "1710034065");
        else data.put("decisionReason", "No coincide <documento> & registro.");
        var claimed = new OutboxMail(42, UUID.randomUUID(), "BILLING_IDENTITY_DECIDED",
                "decision-reader@example.invalid", 1, json.writeValueAsString(data));
        var gateway = new LeasedDecisionOutbox(claimed);
        var received = new AtomicReference<ReceivedMail>();
        var requests = new AtomicInteger();
        String providerId = "local-decision-" + status.toLowerCase(java.util.Locale.ROOT);
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/api/send", exchange -> {
            requests.incrementAndGet();
            received.set(new ReceivedMail(exchange.getRequestMethod(),
                    exchange.getRequestHeaders().getFirst("Authorization"),
                    exchange.getRequestHeaders().getFirst("Content-Type"),
                    new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8),
                    gateway.state, gateway.providerMessageId));
            byte[] reply = ("{\"success\":true,\"message_ids\":[\"" + providerId + "\"]}")
                    .getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, reply.length);
            exchange.getResponseBody().write(reply);
            exchange.close();
        });
        server.start();
        try {
            var properties = new MailProperties(true,
                    URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/api/send"),
                    "local-decision-test-token", "pliego@example.invalid", "PLIEGO",
                    URI.create("https://pliego.example"), true, Duration.ofSeconds(1), Duration.ofSeconds(2), 1);
            var realTemplates = new MailTemplates(properties,
                    new EmailActionTokens("test-only-0123456789abcdef0123456789abcdef"), json);
            var worker = new MailOutboxWorker(new MailOutboxService(gateway),
                    new MailtrapMailSender(properties, json), realTemplates, properties, json);
            worker.process();

            assertThat(requests.get()).isEqualTo(1);
            var actual = received.get();
            assertThat(actual).as("the new outbox type must reach the real HTTP sender").isNotNull();
            assertThat(actual.method()).isEqualTo("POST");
            assertThat(actual.authorization()).isEqualTo("Bearer local-decision-test-token");
            assertThat(actual.contentType()).isEqualTo("application/json");
            assertThat(actual.stateBeforeResponse()).isEqualTo("SENDING");
            assertThat(actual.providerIdBeforeResponse()).isNull();
            var payload = json.readTree(actual.body());
            assertThat(payload.path("to").get(0).path("email").asString()).isEqualTo(claimed.recipient());
            assertThat(payload.path("category").asString()).isEqualTo("BILLING_IDENTITY_DECIDED");
            assertThat(payload.path("custom_variables").path("pliego_outbox_id").asString()).isEqualTo("42");
            assertThat(payload.path("html").asString()).contains("https://pliego.example/account/identity");
            assertThat(payload.path("text").asString()).contains("Ver identificación: https://pliego.example/account/identity");
            if (status.equals("APPROVED")) {
                assertThat(payload.path("subject").asString()).isEqualTo("Aprobamos tu corrección de identificación");
                assertThat(payload.path("text").asString()).contains("Tu cuenta ahora usa la cédula 1710034065.",
                        "Las facturas ya emitidas conservan sus datos originales.");
                assertThat(payload.path("html").asString()).contains("la cédula 1710034065.",
                        "Las facturas ya emitidas conservan sus datos originales.");
            } else {
                assertThat(payload.path("subject").asString()).isEqualTo("Revisamos tu corrección de identificación");
                assertThat(payload.path("text").asString()).contains("No aprobamos el cambio solicitado.",
                        "No coincide <documento> & registro.");
                assertThat(payload.path("html").asString()).contains("No coincide &lt;documento&gt; &amp; registro.")
                        .doesNotContain("<documento>");
            }
            // A wrong ID/owner cannot persist SENT in the fake lease boundary.
            assertThat(gateway.prepared).isTrue();
            assertThat(gateway.completionId).isEqualTo(claimed.id());
            assertThat(gateway.completionOwner).isEqualTo(claimed.owner());
            assertThat(gateway.state).isEqualTo("SENT");
            assertThat(gateway.providerMessageId).isEqualTo(providerId);
            assertThat(gateway.error).isNull();
        } finally { server.stop(0); }
    }

    private record ReceivedMail(String method, String authorization, String contentType, String body,
            String stateBeforeResponse, String providerIdBeforeResponse) { }

    /** Queue fixture with a real lease fence; no template, worker or sender is mocked. */
    private static final class LeasedDecisionOutbox implements MailOutboxGateway {
        private final OutboxMail claimed;
        private boolean offered;
        private boolean prepared;
        private volatile String state = "PENDING";
        private volatile String providerMessageId;
        private String error;
        private Long completionId;
        private UUID completionOwner;

        private LeasedDecisionOutbox(OutboxMail claimed) { this.claimed = claimed; }

        @Override public OutboxMail claim() {
            if (offered) return null;
            offered = true;
            state = "SENDING";
            return claimed;
        }

        @Override public boolean prepareSend(OutboxMail mail) {
            prepared = ownsLease(mail);
            return prepared;
        }

        @Override public boolean complete(OutboxMail mail, String outcome, String code, String providerId) {
            if (!prepared || !ownsLease(mail)) return false;
            completionId = mail.id();
            completionOwner = mail.owner();
            error = code;
            providerMessageId = providerId;
            state = outcome;
            return true;
        }

        private boolean ownsLease(OutboxMail mail) {
            return state.equals("SENDING") && mail.id() == claimed.id() && mail.owner().equals(claimed.owner());
        }
    }

}
