package com.pliego.modules.identity.api;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(name = "RegisterResponse")
public record RegisterResponse(
        @Schema(example = "100", pattern = "^[1-9][0-9]*$") String userId,
        @Schema(example = "87", pattern = "^[1-9][0-9]*$") String customerId,
        @Schema(example = "ACTIVE", allowableValues = { "ACTIVE" }) String state) {
}
