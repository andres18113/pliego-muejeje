package com.pliego.modules.identity.api;

import io.swagger.v3.oas.annotations.media.Schema;
import com.pliego.foundation.validation.PersonName;
import com.pliego.foundation.validation.PersonRules;
import com.pliego.foundation.validation.PhoneNumber;
import com.pliego.foundation.validation.PhoneNumbers;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import com.pliego.foundation.security.ValidPassword;

@Schema(name = "RegisterRequest", description = "Crea una cuenta CUSTOMER pendiente de verificación de correo.")
public record RegisterRequest(
        @NotBlank(message = "El correo es obligatorio.") @Email(message = "El correo tiene un formato inválido.") @Size(max = 254, message = "El correo no puede superar 254 caracteres.") @Schema(example = "usuario@example.com", maxLength = 254) String email,
        @NotNull(message = "La contraseña es obligatoria.") @ValidPassword @Schema(format = "password", description = "Al menos 8 caracteres Unicode y máximo 72 bytes en UTF-8.", example = "password-segura", minLength = 8, maxLength = 72) String password,
        @PersonName(label = "nombres") @Schema(example = "Ana María", requiredMode = Schema.RequiredMode.REQUIRED, minLength = 1, maxLength = 120) String firstNames,
        @PersonName(label = "apellidos") @Schema(example = "Pérez López", requiredMode = Schema.RequiredMode.REQUIRED, minLength = 1, maxLength = 120) String lastNames,
        @PhoneNumber
        @Schema(example = "+59325550134", nullable = true, description = "Prefijo internacional obligatorio; admite separadores de presentación.") String phone) {

    public RegisterRequest {
        firstNames=PersonRules.name(firstNames); lastNames=PersonRules.name(lastNames);
        phone=PhoneNumbers.normalized(phone);
    }

    @Override
    public String toString() {
        return "RegisterRequest[personalData=[redacted], credentials=[redacted]]";
    }
}
