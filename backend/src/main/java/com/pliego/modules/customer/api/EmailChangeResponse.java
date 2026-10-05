package com.pliego.modules.customer.api;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(name = "EmailChangeResponse", description = "Correo de inicio de sesión vigente, normalizado.")
public record EmailChangeResponse(@Schema(example = "nuevo@example.com") String email) {
}
