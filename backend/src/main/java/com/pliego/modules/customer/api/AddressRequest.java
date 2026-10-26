package com.pliego.modules.customer.api;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.Locale;
import com.pliego.foundation.validation.AddressRecipient;
import com.pliego.foundation.validation.PersonRules;
import com.pliego.foundation.validation.PhoneNumber;
import com.pliego.foundation.validation.PhoneNumbers;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import jakarta.validation.constraints.DecimalMax;

@Schema(name = "AddressRequest", description = "Datos completos de una dirección del cliente.")
public record AddressRequest(
        @NotBlank(message = "El alias es obligatorio.") @Size(max = 80, message = "El alias no puede superar 80 caracteres.")
        @Schema(example = "Casa", maxLength = 80) String alias,
        @AddressRecipient
        @Schema(example = "Ana Pérez", requiredMode = Schema.RequiredMode.REQUIRED, minLength = 1, maxLength = 241) String recipient,
        @NotBlank(message = "La dirección principal es obligatoria.") @Size(max = 200, message = "La dirección principal no puede superar 200 caracteres.")
        @Schema(example = "Av. Principal 123", maxLength = 200) String line1,
        @Size(max = 200, message = "El complemento no puede superar 200 caracteres.")
        @Schema(example = "Departamento 4", nullable = true, maxLength = 200) String line2,
        @Pattern(regexp = "^[1-9][0-9]{0,18}$", message = "La provincia seleccionada no es válida.")
        @DecimalMax(value = "9223372036854775807", message = "La provincia seleccionada no es válida.")
        @Schema(example = "17", description = "ID decimal de GET /api/v1/geo/provinces. Envíalo junto con cityId, o usa city/province durante la transición.") String provinceId,
        @Pattern(regexp = "^[1-9][0-9]{0,18}$", message = "La ciudad seleccionada no es válida.")
        @DecimalMax(value = "9223372036854775807", message = "La ciudad seleccionada no es válida.")
        @Schema(example = "893", description = "ID decimal de GET /api/v1/geo/provinces/{provinceId}/cities. Envíalo junto con provinceId, o usa city/province durante la transición.") String cityId,
        @NotBlank(message = "El código de país es obligatorio.") @Pattern(regexp = "^EC$", message = "Las entregas están disponibles únicamente en Ecuador.")
        @Schema(example = "EC", pattern = "^EC$", allowableValues = {"EC"}) String countryCode,
        @Size(max = 20, message = "El código postal no puede superar 20 caracteres.")
        @Schema(example = "170101", nullable = true, maxLength = 20) String postalCode,
        @Size(max = 300, message = "La referencia no puede superar 300 caracteres.")
        @Schema(example = "Frente al parque", nullable = true, maxLength = 300) String reference,
        @PhoneNumber(required = true)
        @Schema(example = "+59325550134", requiredMode = Schema.RequiredMode.REQUIRED, description = "Teléfono de Ecuador (+593): 9 dígitos para celular o 8 para fijo.") String phone,
        @NotNull(message = "Indica si la dirección debe ser principal.")
        @Schema(example = "true") Boolean makePrimary,
        @Size(max = 120, message = "La ciudad no puede superar 120 caracteres.")
        @com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL)
        @Schema(deprecated = true, nullable = true, description = "Compatibilidad temporal para versiones SPA anteriores; el nombre se resuelve contra el catálogo y nunca se guarda como texto libre.") String city,
        @Size(max = 120, message = "La provincia no puede superar 120 caracteres.")
        @com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL)
        @Schema(deprecated = true, nullable = true, description = "Compatibilidad temporal para versiones SPA anteriores; el nombre se resuelve contra el catálogo y nunca se guarda como texto libre.") String province) {
    public AddressRequest { recipient=PersonRules.name(recipient); phone=PhoneNumbers.normalized(phone); countryCode=countryCode == null ? null : countryCode.strip().toUpperCase(Locale.ROOT); }

    @AssertTrue(message = "Envía provinceId y cityId juntos, o ciudad y provincia juntos.")
    @com.fasterxml.jackson.annotation.JsonIgnore
    @Schema(hidden = true)
    public boolean isGeographicChoiceValid() {
        boolean ids = hasText(provinceId) && hasText(cityId);
        boolean names = hasText(city) && hasText(province);
        boolean anyId = hasText(provinceId) || hasText(cityId);
        boolean anyName = hasText(city) || hasText(province);
        return (ids && !anyName) || (names && !anyId);
    }

    public boolean usesLegacyNames() { return hasText(city) && hasText(province); }

    private static boolean hasText(String value) { return value != null && !value.isBlank(); }
}
