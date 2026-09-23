package com.pliego.modules.customer.api;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import jakarta.validation.constraints.NotBlank;

@Schema(name = "ProfileUpdateRequest", description = "Reemplaza los datos mutables del perfil CUSTOMER.")
public record ProfileUpdateRequest(
        @NotBlank(message = "El nombre no puede estar vacío.")
        @Size(max = 120, message = "El nombre no puede superar 120 caracteres.")
        @Schema(example = "Ana María", maxLength = 120) String firstNames,
        @NotBlank(message = "Los apellidos no pueden estar vacíos.")
        @Size(max = 120, message = "Los apellidos no pueden superar 120 caracteres.")
        @Schema(example = "Pérez López", maxLength = 120) String lastNames,
        @Pattern(regexp = "^$|^\\+?[0-9]{7,19}$", message = "El teléfono tiene un formato inválido.")
        @Schema(example = "+59325550134", pattern = "^\\+?[0-9]{7,19}$", nullable = true) String phone) {
}
