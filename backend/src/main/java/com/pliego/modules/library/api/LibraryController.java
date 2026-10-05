package com.pliego.modules.library.api;

import com.pliego.foundation.web.PageResponse;
import com.pliego.modules.library.application.LibraryModels;
import com.pliego.modules.library.application.LibraryService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

@Validated
@RestController
@RequestMapping("/api/v1/me/library")
@SecurityRequirement(name="bearerJwt")
@Tag(name="Mi biblioteca",description="Propiedad de ediciones digitales adquiridas; no entrega contenido.")
public class LibraryController {
    private final LibraryService service;
    public LibraryController(LibraryService service) { this.service=service; }
    @GetMapping
    @Operation(operationId="listOwnedDigitalItems",summary="Consultar títulos digitales propios",description="Incluye propiedad revocada para conservar historial de compra.")
    public PageResponse<LibraryModels.Item> list(@AuthenticationPrincipal Jwt jwt,
            @RequestParam(required=false) @Pattern(regexp="EBOOK|AUDIOBOOK",message="El tipo de edición no es válido.") String productType,
            @RequestParam(defaultValue="0") @Min(value=0,message="La página debe ser mayor o igual que cero.") int page,
            @RequestParam(defaultValue="20") @Min(value=1,message="El tamaño de página debe ser al menos uno.") @Max(value=50,message="El tamaño de página no puede superar cincuenta.") int pageSize) {
        var result=service.list(Long.parseLong(jwt.getSubject()),productType,page,pageSize);
        return new PageResponse<>(result.items(),page,pageSize,Long.toString(result.totalCount()));
    }
    @GetMapping("/{ownedItemId}")
    @Operation(operationId="getOwnedDigitalItem",summary="Consultar propiedad y compra de un título digital propio")
    public LibraryModels.Item detail(@AuthenticationPrincipal Jwt jwt,@PathVariable @Positive(message="El título de biblioteca debe ser un identificador positivo.") long ownedItemId) {
        return service.detail(Long.parseLong(jwt.getSubject()),ownedItemId);
    }
}
