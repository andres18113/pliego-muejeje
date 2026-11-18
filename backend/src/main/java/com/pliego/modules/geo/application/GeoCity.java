package com.pliego.modules.geo.application;

import java.util.List;
import io.swagger.v3.oas.annotations.media.Schema;

public record GeoCity(
        @Schema(example = "495", requiredMode = Schema.RequiredMode.REQUIRED) String id,
        @Schema(example = "0927", requiredMode = Schema.RequiredMode.REQUIRED) String code,
        @Schema(example = "General Antonio Elizalde", requiredMode = Schema.RequiredMode.REQUIRED) String name,
        @Schema(allowableValues = {"CABECERA_CANTONAL", "PARROQUIA_RURAL"}, requiredMode = Schema.RequiredMode.REQUIRED) String kind,
        @Schema(example = "General Antonio Elizalde", requiredMode = Schema.RequiredMode.REQUIRED) String cantonName,
        @Schema(description = "Nombres alternativos oficiales para búsqueda, ordenados con colación española.",
                requiredMode = Schema.RequiredMode.REQUIRED) List<String> aliases) {
    public GeoCity { aliases = List.copyOf(aliases); }
}
