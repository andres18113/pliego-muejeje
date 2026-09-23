package com.pliego.modules.customer.api;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

@Schema(name = "AddressUpdateRequest", description = "Reemplaza todos los datos mutables de la dirección.")
public record AddressUpdateRequest(
        @NotBlank(message = "El alias es obligatorio.") @Size(max = 80, message = "El alias no puede superar 80 caracteres.")
        @Schema(example = "Casa", maxLength = 80) String alias,
        @NotBlank(message = "El destinatario es obligatorio.") @Size(max = 200, message = "El destinatario no puede superar 200 caracteres.")
        @Schema(example = "Ana Pérez", maxLength = 200) String recipient,
        @NotBlank(message = "La dirección principal es obligatoria.") @Size(max = 200, message = "La dirección principal no puede superar 200 caracteres.")
        @Schema(example = "Av. Principal 123", maxLength = 200) String line1,
        @Size(max = 200, message = "El complemento no puede superar 200 caracteres.")
        @Schema(example = "Departamento 4", nullable = true, maxLength = 200) String line2,
        @NotBlank(message = "La ciudad es obligatoria.") @Size(max = 100, message = "La ciudad no puede superar 100 caracteres.")
        @Schema(example = "Quito", maxLength = 100) String city,
        @NotBlank(message = "La provincia es obligatoria.") @Size(max = 100, message = "La provincia no puede superar 100 caracteres.")
        @Schema(example = "Pichincha", maxLength = 100) String province,
        @NotBlank(message = "El código de país es obligatorio.") @Pattern(regexp = "^[A-Za-z]{2}$", message = "El código de país debe tener dos letras.")
        @Schema(example = "EC", pattern = "^[A-Za-z]{2}$") String countryCode,
        @Size(max = 20, message = "El código postal no puede superar 20 caracteres.")
        @Schema(example = "170101", nullable = true, maxLength = 20) String postalCode,
        @Size(max = 300, message = "La referencia no puede superar 300 caracteres.")
        @Schema(example = "Frente al parque", nullable = true, maxLength = 300) String reference,
        @NotBlank(message = "El teléfono es obligatorio.") @Pattern(regexp = "^\\+?[0-9]{7,19}$", message = "El teléfono tiene un formato inválido.")
        @Schema(example = "+59325550134", pattern = "^\\+?[0-9]{7,19}$") String phone) {
}
