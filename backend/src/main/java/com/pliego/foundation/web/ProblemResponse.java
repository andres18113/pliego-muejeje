package com.pliego.foundation.web;

import java.net.URI;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(name = "ProblemDetail", description = "RFC 9457 Problem Details with PLIEGO correlation fields.")
public record ProblemResponse(
        @Schema(example = "urn:pliego:problem:VALIDATION_ERROR") URI type,
        @Schema(example = "Datos inválidos") String title,
        @Schema(example = "400") int status,
        @Schema(example = "Revisa los datos enviados e intenta nuevamente.") String detail,
        @Schema(example = "/api/v1/auth/register") URI instance,
        @Schema(example = "VALIDATION_ERROR") String code,
        @Schema(example = "8f2ab598-3e33-40b1-a5c7-15f676a84f9a") String traceId) {
}
