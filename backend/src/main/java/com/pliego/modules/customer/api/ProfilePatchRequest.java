package com.pliego.modules.customer.api;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.Size;
import com.fasterxml.jackson.annotation.JsonProperty;
import io.swagger.v3.oas.annotations.media.Schema;
import com.pliego.foundation.validation.PersonRules;
import com.pliego.foundation.validation.PhoneNumbers;

/** A null value clears only phone. PostgreSQL validates the selected field. */
@ValidProfileValue
public record ProfilePatchRequest(
        @NotNull(message = "El campo es obligatorio.")
        @Pattern(regexp = "firstNames|lastNames|phone", message = "El campo del perfil no es válido.") String field,
        @JsonProperty(value = "value", required = true)
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true)
        String value,
        @NotNull(message = "La versión del perfil es obligatoria.")
        @Pattern(regexp = "^(0|[1-9][0-9]{0,18})$", message = "La versión del perfil no es válida.")
        @DecimalMax(value = "9223372036854775807", message = "La versión del perfil no es válida.") String expectedVersion) {
    public ProfilePatchRequest {
        value = "phone".equals(field) ? PhoneNumbers.normalized(value)
                : ("firstNames".equals(field) || "lastNames".equals(field)) ? PersonRules.name(value) : value;
    }
}
