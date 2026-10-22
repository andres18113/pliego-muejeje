package com.pliego.modules.customer.api;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import com.pliego.foundation.validation.EcuadorianIdentification;
import com.pliego.foundation.validation.ValidEcuadorianIdentification;

@ValidEcuadorianIdentification
public record BillingIdentityRequest(
        @NotNull(message = "Selecciona el tipo de identificación.")
        @Pattern(regexp = "EC_CEDULA|EC_RUC", message = "Selecciona cédula o RUC.") String type,
        String number) implements ValidEcuadorianIdentification.Value {
    public BillingIdentityRequest { number = EcuadorianIdentification.normalized(number); }
    @Override public String toString() { return "BillingIdentityRequest[redacted]"; }
}
