package com.pliego.modules.customer.api;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import com.pliego.foundation.validation.EcuadorianIdentification;
import com.pliego.foundation.validation.ValidEcuadorianIdentification;

/**
 * A correction names the number the customer saw, so a stale screen never overwrites a newer value. It may also
 * change the kind of identification (cédula ↔ RUC).
 */
@ValidEcuadorianIdentification
public record BillingIdentityCorrectionRequest(
        @NotNull(message = "Selecciona el tipo de identificación.")
        @Pattern(regexp = "EC_CEDULA|EC_RUC", message = "Selecciona cédula o RUC.") String type,
        @NotBlank(message = "Consulta tu identificación actual antes de corregirla.")
        @Size(max = 32, message = "Consulta tu identificación actual antes de corregirla.") String currentNumber,
        String number,
        @NotBlank(message = "Escribe tu contraseña actual para confirmar la corrección.")
        @Size(max = 256, message = "La contraseña actual no es válida.")
        @Schema(format = "password", description = "Contraseña actual, para confirmar la corrección.", maxLength = 256) String currentPassword)
        implements ValidEcuadorianIdentification.Value {
    public BillingIdentityCorrectionRequest {
        currentNumber = EcuadorianIdentification.normalized(currentNumber);
        number = EcuadorianIdentification.normalized(number);
    }
    @jakarta.validation.constraints.AssertTrue(message = "Escribe una identificación distinta a la actual.")
    @com.fasterxml.jackson.annotation.JsonIgnore
    public boolean isChanged() { return number == null || !number.equals(currentNumber); }
    @Override public String toString() { return "BillingIdentityCorrectionRequest[redacted]"; }
}
