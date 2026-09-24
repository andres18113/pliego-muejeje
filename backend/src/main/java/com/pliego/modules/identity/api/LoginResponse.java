package com.pliego.modules.identity.api;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(name = "LoginResponse")
public record LoginResponse(
        @Schema(format = "jwt") String accessToken,
        @Schema(example = "Bearer") String tokenType,
        @Schema(example = "1800") int expiresInSeconds,
        AuthenticatedUser user) {

    @Override
    public String toString() {
        return "LoginResponse[accessToken=[redacted], tokenType=" + tokenType + ", expiresInSeconds="
                + expiresInSeconds + ", user=[redacted]]";
    }

    @Schema(name = "AuthenticatedUser")
    public record AuthenticatedUser(
            @Schema(example = "100", pattern = "^[1-9][0-9]*$") String userId,
            @Schema(example = "usuario@example.com") String email,
            @Schema(example = "CUSTOMER", allowableValues = { "CUSTOMER", "ADMIN" }) String role) {

        @Override
        public String toString() {
            return "AuthenticatedUser[identity=[redacted]]";
        }
    }
}
