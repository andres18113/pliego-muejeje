package com.pliego.modules.customer.api;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

@Schema(name = "EmailChangeRequest", description = "Cambia el correo de inicio de sesión del CUSTOMER autenticado; requiere su contraseña actual.")
public record EmailChangeRequest(
        @NotBlank(message = "El correo es obligatorio.") @Email(message = "El correo tiene un formato inválido.") @Size(max = 254, message = "El correo no puede superar 254 caracteres.") @Schema(example = "nuevo@example.com", maxLength = 254) String newEmail,
        @NotBlank(message = "La contraseña actual es obligatoria.") @Size(max = 256, message = "La contraseña actual no es válida.") @Schema(format = "password", description = "Contraseña actual, para confirmar el cambio.", maxLength = 256) String currentPassword) {

    @Override
    public String toString() {
        return "EmailChangeRequest[newEmail=" + newEmail + ", currentPassword=***]";
    }
}
