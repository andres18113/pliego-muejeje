package com.pliego.modules.identity.api;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import com.pliego.foundation.security.ValidPassword;

@Schema(name = "RegisterRequest", description = "Crea una cuenta CUSTOMER activa.")
public record RegisterRequest(
        @NotBlank(message = "El correo es obligatorio.") @Email(message = "El correo tiene un formato inválido.") @Size(max = 254, message = "El correo no puede superar 254 caracteres.") @Schema(example = "usuario@example.com", maxLength = 254) String email,
        @NotNull(message = "La contraseña es obligatoria.") @ValidPassword @Schema(format = "password", description = "Al menos 8 caracteres Unicode y máximo 72 bytes en UTF-8.", example = "password-segura", minLength = 8, maxLength = 72) String password,
        @NotBlank(message = "El nombre no puede estar vacío.") @Size(max = 120, message = "El nombre no puede superar 120 caracteres.") @Schema(example = "Ana María", maxLength = 120) String firstNames,
        @NotBlank(message = "Los apellidos no pueden estar vacíos.") @Size(max = 120, message = "Los apellidos no pueden superar 120 caracteres.") @Schema(example = "Pérez López", maxLength = 120) String lastNames,
        @Pattern(regexp = "^$|^\\+?[0-9]{7,19}$", message = "El teléfono tiene un formato inválido.")
        @Schema(example = "+59325550134", pattern = "^\\+?[0-9]{7,19}$", nullable = true) String phone) {

    @Override
    public String toString() {
        return "RegisterRequest[personalData=[redacted], credentials=[redacted]]";
    }
}
