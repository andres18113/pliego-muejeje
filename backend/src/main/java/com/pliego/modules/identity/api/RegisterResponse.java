package com.pliego.modules.identity.api;

import io.swagger.v3.oas.annotations.media.Schema;

/** No account identifiers or existence signal in a public registration response. */
@Schema(name = "RegisterResponse")
public record RegisterResponse(
        @Schema(example = "PENDING_VERIFICATION", allowableValues = { "PENDING_VERIFICATION" },
                description="Si corresponde, recibirás un correo para verificar tu cuenta. Esta respuesta no confirma si existe.") String state) {
}
