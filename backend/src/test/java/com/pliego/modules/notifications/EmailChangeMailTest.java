package com.pliego.modules.notifications;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;

import com.pliego.modules.identity.application.EmailActionTokens;
import com.pliego.modules.notifications.application.MailProperties;
import com.pliego.modules.notifications.application.MailTemplates;
import java.net.URI;
import java.time.Duration;
import java.util.List;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

class EmailChangeMailTest {
    private final ObjectMapper json = new ObjectMapper();
    private final EmailActionTokens tokens = new EmailActionTokens("test-only-0123456789abcdef0123456789abcdef");
    private final MailTemplates templates = new MailTemplates(new MailProperties(false, null, null, null, null,
            URI.create("https://pliego.example"), false, Duration.ofSeconds(1), Duration.ofSeconds(2), 1), tokens, json);

    @Test
    void changeCredentialsUseSeparatePurposesAndNeverPrintSecrets() {
        var confirm = assertDoesNotThrow(() -> tokens.issue("EMAIL_CHANGE_CONFIRM"));
        var cancel = assertDoesNotThrow(() -> tokens.issue("EMAIL_CHANGE_CANCEL"));
        assertThat(confirm.nonce()).isNotEqualTo(cancel.nonce());
        String raw = tokens.derive("EMAIL_CHANGE_CONFIRM", confirm.nonce());
        assertThat(raw).matches("[A-Za-z0-9_-]{43}");
        assertThat(confirm.hash()).isEqualTo(EmailActionTokens.hash(raw));
        assertThat(confirm.toString()).doesNotContain(raw, confirm.nonce(), confirm.hash());
        assertThat(cancel.toString()).doesNotContain(cancel.nonce(), cancel.hash());
        assertThat(List.of("VERIFY_EMAIL", "RESET_PASSWORD", "EMAIL_CHANGE_CONFIRM", "EMAIL_CHANGE_CANCEL")
                .stream().map(purpose -> tokens.derive(purpose, confirm.nonce())).distinct()).hasSize(4);
        assertThatThrownBy(() -> tokens.derive("EMAIL_CHANGE_REQUESTED", confirm.nonce()))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void confirmationUsesExactSpanishCopyAndFragmentWithoutExposingTheOldAddress() {
        var credential = assertDoesNotThrow(() -> tokens.issue("EMAIL_CHANGE_CONFIRM"));
        var message = templates.render("EMAIL_CHANGE_CONFIRM", json.createObjectNode()
                .put("nonce", credential.nonce()).put("currentEmail", "private-old@example.com"));
        String url = "https://pliego.example/confirmar-correo#token="
                + tokens.derive("EMAIL_CHANGE_CONFIRM", credential.nonce());
        assertThat(message.subject()).isEqualTo("Confirma tu nuevo correo en PLIEGO");
        assertThat(message.text()).contains("Confirma tu nuevo correo",
                "Confirma esta dirección para usarla en tu cuenta de PLIEGO. Hasta que lo hagas, tu cuenta sigue usando tu correo actual.",
                "Confirmar correo: " + url,
                "El enlace vence en 24 horas. Si no pediste este cambio, ignora este mensaje.")
                .doesNotContain("private-old@example.com", "?token=", credential.nonce());
        assertThat(message.html()).contains("href=\"" + url + "\"", "/brand/pliego-logo-email.png")
                .doesNotContain("private-old@example.com", "restablecer-contrasena", "email-v1/");
    }

    @Test
    void requestNoticeUsesMaskedAddressAndItsOwnCancelCredential() {
        var credential = assertDoesNotThrow(() -> tokens.issue("EMAIL_CHANGE_CANCEL"));
        var message = templates.render("EMAIL_CHANGE_REQUESTED", json.createObjectNode()
                .put("nonce", credential.nonce()).put("maskedEmail", "an•••@gmail.com"));
        String url = "https://pliego.example/cancelar-cambio-correo#token="
                + tokens.derive("EMAIL_CHANGE_CANCEL", credential.nonce());
        assertThat(message.subject()).isEqualTo("Se pidió cambiar el correo de tu cuenta PLIEGO");
        assertThat(message.text()).contains("¿Cambiaste tu correo?",
                "Se pidió usar an•••@gmail.com como correo de tu cuenta. Tu cuenta seguirá usando esta dirección hasta que se confirme el cambio.",
                "No fui yo: cancelar el cambio: " + url,
                "Si fuiste tú, no necesitas hacer nada.");
        assertThat(message.html()).contains("href=\"" + url + "\"")
                .doesNotContain(tokens.derive("EMAIL_CHANGE_CONFIRM", credential.nonce()), "?token=");
    }

    @Test
    void changedNoticePointsToHelpAndEscapesSnapshotText() {
        var message = assertDoesNotThrow(() -> templates.render("EMAIL_CHANGED", json.createObjectNode()
                .put("maskedEmail", "an•••@gmail.com <script> &")));
        assertThat(message.subject()).isEqualTo("El correo de tu cuenta PLIEGO cambió");
        assertThat(message.text()).contains("Tu correo cambió",
                "Desde ahora tu cuenta usa an•••@gmail.com <script> &. Si no fuiste tú, escríbenos desde Ayuda.",
                "Ir a Ayuda: https://pliego.example/ayuda");
        assertThat(message.html()).contains("an•••@gmail.com &lt;script&gt; &amp;", "href=\"https://pliego.example/ayuda\"")
                .doesNotContain("<script>", "restablecer-contrasena", "#token=", "?token=");
    }
}
