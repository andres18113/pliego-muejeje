package com.pliego.modules.sales.api;

import java.util.List;
import org.springframework.web.bind.annotation.*;
import com.pliego.modules.sales.application.PickupService;
import com.pliego.modules.sales.application.PickupLocation;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;

@RestController
@RequestMapping(path="/api/v1/pickup-locations",produces="application/json")
@Tag(name="Pickup locations")
public class PickupLocationController {
    private final PickupService service;
    public PickupLocationController(PickupService service) {this.service=service;}
    @GetMapping
    @Operation(summary="Consultar puntos de retiro activos",description="Dirección, coordenadas, zona horaria, horario informativo y minutos estimados de preparación. No contiene contratos de proveedores de mapas.")
    public List<PickupLocation> locations() {return service.locations();}
}
