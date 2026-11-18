package com.pliego.modules.geo.application;

import io.swagger.v3.oas.annotations.media.Schema;

public record GeoProvince(
        @Schema(example = "17", requiredMode = Schema.RequiredMode.REQUIRED) String id,
        @Schema(example = "17", requiredMode = Schema.RequiredMode.REQUIRED) String code,
        @Schema(example = "Pichincha", requiredMode = Schema.RequiredMode.REQUIRED) String name) { }
