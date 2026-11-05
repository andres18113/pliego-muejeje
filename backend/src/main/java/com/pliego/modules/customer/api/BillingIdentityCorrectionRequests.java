package com.pliego.modules.customer.api;

import com.pliego.foundation.validation.ValidEcuadorianIdentification;
import com.pliego.foundation.validation.EcuadorianIdentification;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/** Customer-submitted correction request; current number is a compare-and-set value, not proof of ownership. */
public final class BillingIdentityCorrectionRequests {
    private BillingIdentityCorrectionRequests() { }

    @ValidEcuadorianIdentification
    public record Submit(
            @NotNull(message = "Selecciona el tipo de identificación propuesto.")
            @Pattern(regexp = "EC_CEDULA|EC_RUC", message = "Selecciona cédula o RUC.") String type,
            @NotBlank(message = "Consulta tu identificación actual antes de solicitar la corrección.")
            @Pattern(regexp = "^(?:[0-9]{10}|[0-9]{13})$", message = "La identificación actual no es válida.")
            String currentNumber,
            String number,
            @NotNull(message = "Selecciona el motivo de la solicitud.")
            @Pattern(regexp = "DOCUMENT_TYPO|DOCUMENT_CHANGED|OTHER", message = "El motivo de la solicitud no es válido.")
            String reasonCode,
            @Size(max = 500, message = "La nota no puede superar 500 caracteres.")
            @Schema(description = "Nota opcional; se recortan los espacios exteriores.", maxLength = 500) String note)
            implements ValidEcuadorianIdentification.Value {
        public Submit {
            currentNumber = EcuadorianIdentification.normalized(currentNumber);
            number = EcuadorianIdentification.normalized(number);
            note = note == null ? null : note.trim();
        }
        @Override public String toString() { return "BillingIdentityCorrectionRequests.Submit[redacted]"; }
    }
}
