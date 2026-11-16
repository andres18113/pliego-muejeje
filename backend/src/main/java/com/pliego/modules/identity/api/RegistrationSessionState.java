package com.pliego.modules.identity.api;

import io.swagger.v3.oas.annotations.media.Schema;

public record RegistrationSessionState(
        @Schema(allowableValues={"PENDING_VERIFICATION","REFRESH_REQUIRED","RETRY_LATER"}) String state) {}
