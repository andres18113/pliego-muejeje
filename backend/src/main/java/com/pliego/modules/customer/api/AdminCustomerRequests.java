package com.pliego.modules.customer.api;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

/** Request bodies for administrative customer operations. */
public final class AdminCustomerRequests {
    private AdminCustomerRequests() { }

    public record Status(@NotBlank(message = "El estado debe ser ACTIVE o BLOCKED.")
            @Pattern(regexp = "ACTIVE|BLOCKED", message = "El estado debe ser ACTIVE o BLOCKED.") String state) { }
}
