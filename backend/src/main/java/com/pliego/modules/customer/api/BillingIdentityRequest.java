package com.pliego.modules.customer.api;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import com.pliego.foundation.validation.ValidEcuadorianCedula;
import com.pliego.foundation.validation.EcuadorianCedula;

public record BillingIdentityRequest(
        @NotNull(message = "Selecciona el tipo de identificación.")
        @Pattern(regexp = "EC_CEDULA", message = "Selecciona cédula ecuatoriana.") String type,
        @ValidEcuadorianCedula String number) {
    public BillingIdentityRequest { number = EcuadorianCedula.normalized(number); }
    @Override public String toString() { return "BillingIdentityRequest[redacted]"; }
}
