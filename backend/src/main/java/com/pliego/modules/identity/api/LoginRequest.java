package com.pliego.modules.identity.api;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import com.pliego.foundation.security.ValidPassword;

@Schema(name = "LoginRequest")
public record LoginRequest(
        @NotBlank(message = "El correo es obligatorio.") @Email(message = "El correo tiene un formato inválido.") @Size(max = 254, message = "El correo no puede superar 254 caracteres.") @Schema(example = "usuario@example.com", maxLength = 254) String email,
        @NotEmpty(message = "La contraseña es obligatoria.") @ValidPassword(minimumCodePoints = 0, message = "La contraseña no cumple la política requerida.") @Schema(format = "password", description = "Máximo 72 bytes en UTF-8.", maxLength = 72) String password) {

    @Override
    public String toString() {
        return "LoginRequest[email=" + email + ", password=[redacted]]";
    }
}
