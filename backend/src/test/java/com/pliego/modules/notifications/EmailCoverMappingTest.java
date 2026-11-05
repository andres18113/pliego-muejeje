package com.pliego.modules.notifications;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

import com.pliego.modules.identity.application.EmailActionTokens;
import com.pliego.modules.notifications.application.MailProperties;
import com.pliego.modules.notifications.application.MailTemplates;
import java.net.URI;
import java.io.InputStream;
import java.time.Duration;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import tools.jackson.databind.ObjectMapper;

@ExtendWith(MockitoExtension.class)
class EmailCoverMappingTest {
    private static final String COVER = "https://covers.pliegolibros.com/covers/editions/v2/PLG-BK-000390-d2c065f3dcad.webp";
    private static final String EMAIL_COVER = "https://covers.pliegolibros.com/covers/editions/email-v1/PLG-BK-000390-d2c065f3dcad.jpg";
    private final ObjectMapper json = new ObjectMapper();
    private final MailTemplates templates = new MailTemplates(new MailProperties(false, null, null, null, null,
            URI.create("https://pliegolibros.com"), false, Duration.ofSeconds(1), Duration.ofSeconds(2), 1),
            new EmailActionTokens("0123456789abcdef0123456789abcdef"), json);

    @Test
    void render_allOrderTypes_mapPublicEditionCoverToImage() {
        for (String type : List.of("ORDER_CONFIRMED", "ORDER_STATUS", "ORDER_CANCELLED")) {
            assertThat(render(type, COVER)).contains("src=\"" + EMAIL_COVER + "\"").doesNotContain(COVER);
        }
    }

    @Test
    void render_coverWithoutPublishedRendition_keepsOriginalValidatedUrl() {
        for (String url : List.of(
                "https://covers.pliegolibros.com/covers/editions/v2/future-book.webp",
                "https://covers.pliegolibros.com/covers/editions/email-v1/future-book.jpg",
                "https://covers.pliegolibros.com/covers/editions/older.jpeg",
                "https://covers.pliegolibros.com/covers/editions/older.png")) {
            for (String type : List.of("ORDER_CONFIRMED", "ORDER_STATUS", "ORDER_CANCELLED")) {
                assertThat(render(type, url)).contains("src=\"" + url + "\"");
            }
        }
    }

    @Test
    void render_bundledRenditions_mapsEveryListedWebp() throws Exception {
        try (var input = getClass().getResourceAsStream("/notifications/email-cover-renditions.json")) {
            assertThat(input).isNotNull();
            var mapping = json.readTree(input);
            assertThat(mapping.isObject()).isTrue();
            assertThat(mapping.size()).isPositive();
            for (var entry : mapping.properties()) {
                assertThat(entry.getKey()).matches("https://covers\\.pliegolibros\\.com/covers/editions/(?:[A-Za-z0-9_-]+/)*[A-Za-z0-9_-]+\\.webp");
                assertThat(entry.getValue().asText()).matches("https://covers\\.pliegolibros\\.com/covers/editions/email-v1/[A-Za-z0-9_-]+\\.jpg");
                assertThat(render("ORDER_CONFIRMED", entry.getKey()))
                        .contains("src=\"" + entry.getValue().asText() + "\"");
            }
        }
    }

    @Test
    void render_invalidBundledTargets_keepsOriginalValidatedWebp(@Mock ObjectMapper resourceMapper) throws Exception {
        for (String target : List.of(EMAIL_COVER + "?secret=1", EMAIL_COVER + "#secret",
                "http://covers.pliegolibros.com/covers/editions/email-v1/book.jpg",
                "https://private.r2.dev/invoices/secret.jpg",
                "https://covers.pliegolibros.com/covers/editions/email-v1/../secret.jpg")) {
            when(resourceMapper.readTree(any(InputStream.class))).thenReturn(json.createObjectNode().put(COVER, target));
            var renderer = new MailTemplates(new MailProperties(false, null, null, null, null,
                    URI.create("https://pliegolibros.com"), false, Duration.ofSeconds(1), Duration.ofSeconds(2), 1),
                    new EmailActionTokens("0123456789abcdef0123456789abcdef"), resourceMapper);
            var payload = json.createObjectNode().put("orderId", "42").put("total", "20.64");
            payload.putArray("items").addObject().put("title", "Filosofía de la convivencia")
                    .put("quantity", 1).put("format", "PAPERBACK").put("coverUrl", COVER);
            assertThat(renderer.render("ORDER_CONFIRMED", payload).html()).contains("src=\"" + COVER + "\"")
                    .doesNotContain("secret", "private.r2.dev");
        }
    }

    @Test
    void render_allOrderTypes_rejectPrivateSignedAndMalformedCoverLocations() {
        for (String url : List.of(
                "http://covers.pliegolibros.com/covers/editions/v2/book.webp",
                "//covers.pliegolibros.com/covers/editions/v2/book.webp",
                "javascript:alert(1)", "data:image/png;base64,AAAA",
                "https://private.r2.cloudflarestorage.com/invoices/secret.pdf?X-Amz-Signature=secret",
                "https://private.r2.dev/invoices/secret.pdf",
                "invoices/secret.pdf", "/orders/42/invoice", "/api/v1/orders/42/invoice",
                "https://pliegolibros.com/orders/42/invoice",
                "https://covers.pliegolibros.com/invoices/secret.pdf",
                COVER + "?X-Amz-Signature=secret", COVER + "#secret",
                EMAIL_COVER + "?X-Amz-Signature=secret", EMAIL_COVER + "#secret",
                EMAIL_COVER + "\" onerror=\"alert(1)",
                "https://covers.pliegolibros.com.evil.test/covers/editions/v2/book.webp",
                "https://covers.pliegolibros.com@evil.test/covers/editions/v2/book.webp",
                "https://covers.pliegolibros.com:8443/covers/editions/v2/book.webp",
                "https://covers.pliegolibros.com/covers/editions/../invoices/secret.webp",
                "https://covers.pliegolibros.com/covers/editions/v2/%2e%2e/secret.webp",
                "https://covers.pliegolibros.com/covers/editions/v2/book.webp\n",
                "https://covers.pliegolibros.com/covers/editions/v2/book.webp\" onerror=\"alert(1)",
                "https://covers.pliegolibros.com/covers/editions/v2/book cover.webp")) {
            for (String type : List.of("ORDER_CONFIRMED", "ORDER_STATUS", "ORDER_CANCELLED")) {
                assertThat(render(type, url)).as("%s: %s", type, url).containsOnlyOnce("<img ")
                        .doesNotContain("secret", "onerror=", "javascript:", "data:image");
            }
        }
    }

    @Test
    void render_oldPayloadsWithoutCover_keepTitleAndPlaceholder() {
        for (String type : List.of("ORDER_CONFIRMED", "ORDER_STATUS", "ORDER_CANCELLED")) {
            for (String cover : new String[] {null, "", " "}) {
                assertThat(render(type, cover)).contains("Filosofía de la convivencia").containsOnlyOnce("<img ");
            }
        }
    }

    private String render(String type, String cover) {
        var payload = json.createObjectNode().put("orderId", "42").put("total", "20.64")
                .put("method", "STORE_PICKUP").put("state", "PREPARING");
        var item = payload.putArray("items").addObject().put("title", "Filosofía de la convivencia")
                .put("quantity", 1).put("format", "PAPERBACK");
        if (cover != null) item.put("coverUrl", cover);
        return templates.render(type, payload).html();
    }
}
