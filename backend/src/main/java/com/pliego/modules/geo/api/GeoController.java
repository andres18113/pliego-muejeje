package com.pliego.modules.geo.api;

import java.util.List;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import com.pliego.modules.geo.application.GeoCity;
import com.pliego.modules.geo.application.GeoProvince;
import com.pliego.modules.geo.application.GeoService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.Pattern;

@RestController
@Validated
@RequestMapping(path="/api/v1/geo",produces="application/json")
@Tag(name="Geographic catalog",description="Provincias y localidades activas del Ecuador.")
public class GeoController {
    private static final String REFERENCE_CACHE = "public, max-age=86400, stale-while-revalidate=86400";
    private final GeoService service;

    public GeoController(GeoService service) {
        this.service = service;
    }

    @GetMapping("/provinces")
    @Operation(summary="Consultar provincias",description="Catálogo público de provincias activas, ordenado con colación española.")
    public ResponseEntity<List<GeoProvince>> provinces() {
        return ResponseEntity.ok().header("Cache-Control",REFERENCE_CACHE).body(service.provinces());
    }

    @GetMapping("/provinces/{provinceId}/cities")
    @Operation(summary="Consultar ciudades y parroquias",description="Devuelve localidades activas de una provincia, en orden alfabético español.")
    public ResponseEntity<List<GeoCity>> cities(
            @Parameter(description="ID decimal de la provincia devuelto por GET /api/v1/geo/provinces.")
            @PathVariable @Pattern(regexp="^[1-9][0-9]{0,18}$",message="La provincia seleccionada no es válida.")
            @DecimalMax(value="9223372036854775807",message="La provincia seleccionada no es válida.") String provinceId) {
        return ResponseEntity.ok().header("Cache-Control",REFERENCE_CACHE)
                .body(service.cities(Long.parseLong(provinceId)));
    }
}
