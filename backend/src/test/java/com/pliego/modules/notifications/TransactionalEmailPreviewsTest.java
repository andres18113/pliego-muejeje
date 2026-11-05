package com.pliego.modules.notifications;

import static org.assertj.core.api.Assertions.assertThat;

import com.pliego.modules.identity.application.EmailActionTokens;
import com.pliego.modules.notifications.application.MailMessage;
import com.pliego.modules.notifications.application.MailProperties;
import com.pliego.modules.notifications.application.MailTemplates;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

/** Offline only: constructs the renderer directly, without Spring, a database, workers or a mail sender. */
class TransactionalEmailPreviewsTest {
    private final ObjectMapper json = new ObjectMapper();
    private final MailTemplates templates = new MailTemplates(new MailProperties(false, null, null, null, null,
            URI.create("https://pliegolibros.com"), false, Duration.ofSeconds(1), Duration.ofSeconds(2), 1),
            new EmailActionTokens("preview-only-0123456789abcdef0123456789abcdef"), json);

    @Test
    void render_everyTransactionalTemplate_writeOfflinePreviews() throws Exception {
        String directory = System.getProperty("pliego.email.preview-dir");
        if (directory == null || directory.isBlank()) directory = System.getenv("PLIEGO_EMAIL_PREVIEW_DIR");
        if (directory == null || directory.isBlank()) directory = "/tmp/pliego-email-previews";
        Path output = Path.of(directory).toAbsolutePath();
        Files.createDirectories(output);
        Map<String, MailMessage> messages = new LinkedHashMap<>();

        // Synthetic, deterministic nonce; these tokens have no matching database records.
        var action = json.createObjectNode().put("nonce", "p".repeat(43)).put("expiresAt", "2026-11-02T18:00:00Z");
        messages.put("verify-email", templates.render("VERIFY_EMAIL", action));
        messages.put("verify-email-return-to-checkout", templates.render("VERIFY_EMAIL", action.deepCopy().put("returnTo", "/checkout")));
        messages.put("reset-password", templates.render("RESET_PASSWORD", action));
        messages.put("email-change-confirm", templates.render("EMAIL_CHANGE_CONFIRM", action));
        messages.put("email-change-requested", templates.render("EMAIL_CHANGE_REQUESTED",
                action.deepCopy().put("maskedEmail", "an•••@gmail.com")));
        messages.put("email-changed", templates.render("EMAIL_CHANGED",
                json.createObjectNode().put("maskedEmail", "an•••@gmail.com")));

        var home = order();
        home.set("delivery", json.readTree("""
                {"recipient":"Ana Pérez","line1":"Av. 12 de Octubre N24-180","line2":"Departamento 3",
                 "city":"Quito","province":"Pichincha","country":"EC","postalCode":"170143"}
                """));
        var pickup = order().put("shippingAmount", "0.00").put("total", "72.45");
        pickup.set("pickup", json.readTree("""
                {"location":{"name":"PLIEGO · PUCE","address":"Av. 12 de Octubre y Vicente Ramón Roca",
                 "city":"Quito","province":"Pichincha","countryCode":"EC","timezone":"America/Guayaquil"},
                 "readyAt":"2026-11-01T18:25:00Z","pickupCode":"P-ABC234"}
                """));
        var digital = order().put("subtotal", "12.00").put("originalSubtotal", "12.00")
                .put("taxAmount", "0.00").put("total", "12.00");
        digital.putArray("items").add(order().path("items").get(3));

        messages.put("order-confirmed-home-mixed", templates.render("ORDER_CONFIRMED", home));
        messages.put("order-confirmed-pickup-mixed", templates.render("ORDER_CONFIRMED", pickup));
        messages.put("order-confirmed-digital", templates.render("ORDER_CONFIRMED", digital));
        for (String state : new String[] {"PREPARING", "IN_TRANSIT", "SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED"}) {
            var data = home.deepCopy().put("method", "HOME_DELIVERY").put("state", state);
            if (!state.equals("PREPARING")) data.put("carrier", "Servientrega").put("trackingCode", "DEMO-123456");
            messages.put("order-status-home-" + state.toLowerCase(Locale.ROOT), templates.render("ORDER_STATUS", data));
        }
        for (String state : new String[] {"PENDING", "PREPARING", "READY", "COLLECTED"}) {
            messages.put("order-status-pickup-" + state.toLowerCase(Locale.ROOT), templates.render("ORDER_STATUS",
                    pickup.deepCopy().put("method", "STORE_PICKUP").put("state", state)));
        }
        messages.put("order-status-digital-completed", templates.render("ORDER_STATUS",
                digital.deepCopy().put("method", "DIGITAL").put("state", "COMPLETED")));
        messages.put("order-cancelled-refunded", templates.render("ORDER_CANCELLED",
                home.deepCopy().put("paymentState", "REFUNDED").put("refundAmount", "75.95")));
        messages.put("order-cancelled-unpaid", templates.render("ORDER_CANCELLED", pickup.deepCopy().put("paymentState", "PENDING")));
        messages.put("invoice-issued", templates.render("INVOICE_ISSUED",
                order().put("customerName", "Ana Pérez").put("documentNumber", "999-999-000000042")));

        var legacy = digital.deepCopy();
        ((ObjectNode) legacy.path("items").get(0)).remove("coverUrl");
        legacy.remove("orderReference");
        messages.put("order-confirmed-legacy-no-cover", templates.render("ORDER_CONFIRMED", legacy));

        for (var entry : messages.entrySet()) {
            var message = entry.getValue();
            assertThat(message.html()).startsWith("<!doctype html>").doesNotContain("r2.cloudflarestorage.com", "X-Amz-", "invoices/");
            Files.writeString(output.resolve(entry.getKey() + ".html"), message.html(), StandardCharsets.UTF_8);
            Files.writeString(output.resolve(entry.getKey() + ".txt"), message.subject() + "\n\n" + message.text(), StandardCharsets.UTF_8);
        }
        assertThat(messages).hasSize(23);
        assertThat(messages.get("order-confirmed-home-mixed").html()).contains(
                "src=\"https://covers.pliegolibros.com/covers/editions/email-v1/PLG-BK-000390-d2c065f3dcad.jpg\"",
                "src=\"https://covers.pliegolibros.com/covers/editions/email-v1/PLG-BK-000394-f213c275e813.jpg\"",
                "src=\"https://covers.pliegolibros.com/covers/editions/email-v1/PLG-BK-000415-64e8d6c5db8c.jpg\"",
                "src=\"https://covers.pliegolibros.com/covers/editions/email-v1/PLG-BK-000057-be83a24f55ad.jpg\"")
                .doesNotContain(".webp");
        assertThat(messages.get("order-confirmed-digital").html()).contains(
                "src=\"https://covers.pliegolibros.com/covers/editions/email-v1/PLG-BK-000057-be83a24f55ad.jpg\"");
        assertThat(messages.get("order-confirmed-home-mixed").html().split("<img ")).hasSize(6); // logo + four covers
        assertThat(messages.get("order-confirmed-legacy-no-cover").html().split("<img ")).hasSize(2); // logo only
        System.out.println("Previews de correo: " + messages.size() + " HTML + texto en " + output);
    }

    private ObjectNode order() {
        return (ObjectNode) json.readTree("""
                {"orderId":"42","orderReference":"PL-0123-4567","date":"2026-11-01T18:00:00Z",
                 "subtotal":"72.45","originalSubtotal":"72.45","savingsTotal":"0.00","taxRate":"0.00",
                 "taxAmount":"0.00","shippingAmount":"3.50","total":"75.95","actionPath":"/orders/42","libraryPath":"/biblioteca",
                 "items":[
                  {"title":"Filosofía de la convivencia","authors":"Buatu Batubenge, Omer (coord.); Panduro Muñoz, Benjamín (coord.)",
                   "format":"PAPERBACK","quantity":1,"unitPrice":"17.95","subtotal":"17.95",
                   "coverUrl":"https://covers.pliegolibros.com/covers/editions/v2/PLG-BK-000390-d2c065f3dcad.webp"},
                  {"title":"Educación y filosofía","authors":"Degante Castañeda, Candelario (coord.); Maldonado Gómez, Humberto (coord.)",
                   "format":"PAPERBACK","quantity":1,"unitPrice":"23.50","subtotal":"23.50",
                   "coverUrl":"https://covers.pliegolibros.com/covers/editions/v2/PLG-BK-000394-f213c275e813.webp"},
                  {"title":"La filosofía de la religión","authors":"Grondin, Jean","format":"PAPERBACK","quantity":1,"unitPrice":"19.00","subtotal":"19.00",
                   "coverUrl":"https://covers.pliegolibros.com/covers/editions/v2/PLG-BK-000415-64e8d6c5db8c.webp"},
                  {"title":"Filosofía del conocimiento (2a. ed.)","authors":"Hessen, Johannes","format":"EBOOK","quantity":1,"unitPrice":"12.00","subtotal":"12.00",
                   "coverUrl":"https://covers.pliegolibros.com/covers/editions/v2/PLG-BK-000057-be83a24f55ad.webp"}
                 ]}
                """);
    }
}
