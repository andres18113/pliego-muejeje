package com.pliego.modules.storefront.api;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import com.pliego.modules.storefront.application.StorefrontNavigation;
import com.pliego.modules.storefront.application.StorefrontService;
@RestController
@RequestMapping(path="/api/v1/storefront",produces=MediaType.APPLICATION_JSON_VALUE)
@Tag(name="Navegación pública")
public class StorefrontController {
    private final StorefrontService service;
    public StorefrontController(StorefrontService service) { this.service = service; }
    @GetMapping("/navigation")
    @Operation(operationId="getStorefrontNavigation",summary="Consultar la navegación de la tienda",description="Proyección compacta de Catálogo, Ofertas y Ayuda. Los destacados se ordenan por ventas aprobadas de los últimos 30 días; el desempate y la selección de respaldo usan fecha de creación e identificador de edición.")
    public StorefrontNavigation navigation() { return service.navigation(); }
}
