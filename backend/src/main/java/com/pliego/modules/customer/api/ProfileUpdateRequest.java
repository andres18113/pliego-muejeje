package com.pliego.modules.customer.api;

import io.swagger.v3.oas.annotations.media.Schema;
import com.pliego.foundation.validation.PersonName;
import com.pliego.foundation.validation.PersonRules;
import com.pliego.foundation.validation.PhoneNumber;
import com.pliego.foundation.validation.PhoneNumbers;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.DecimalMax;

@Schema(name = "ProfileUpdateRequest", description = "Reemplaza los datos mutables del perfil CUSTOMER.")
public record ProfileUpdateRequest(
        @PersonName(label = "nombres")
        @Schema(example = "Ana María", requiredMode = Schema.RequiredMode.REQUIRED, minLength = 1, maxLength = 120) String firstNames,
        @PersonName(label = "apellidos")
        @Schema(example = "Pérez López", requiredMode = Schema.RequiredMode.REQUIRED, minLength = 1, maxLength = 120) String lastNames,
        @PhoneNumber
        @Schema(example = "+59325550134", nullable = true, description = "Prefijo internacional obligatorio; admite separadores de presentación.") String phone,
        @NotNull(message = "La versión del perfil es obligatoria.")
        @Pattern(regexp = "^(0|[1-9][0-9]{0,18})$", message = "La versión del perfil no es válida.")
        @DecimalMax(value = "9223372036854775807", message = "La versión del perfil no es válida.") String expectedVersion) {
    public ProfileUpdateRequest {
        firstNames=PersonRules.name(firstNames); lastNames=PersonRules.name(lastNames);
        phone=PhoneNumbers.normalized(phone);
    }


}
