package com.pliego.modules.customer.api;

import java.util.List;
import java.util.UUID;
import java.math.RoundingMode;

import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.RequestHeader;

import com.pliego.foundation.web.ProblemResponse;
import com.pliego.foundation.web.PageResponse;
import com.pliego.modules.customer.api.CustomerFavoriteResponses.Favorite;
import com.pliego.modules.customer.api.CustomerFavoriteResponses.FavoritePage;
import com.pliego.modules.customer.api.CustomerFavoriteResponses.Status;
import com.pliego.modules.customer.application.AddressInput;
import com.pliego.modules.customer.application.CustomerAddress;
import com.pliego.modules.customer.application.CustomerProfile;
import com.pliego.modules.customer.application.CustomerService;
import com.pliego.modules.customer.application.CustomerFavorites;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.ArraySchema;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.ArraySchema;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;

@Validated
@RestController
@RequestMapping(path = "/api/v1", produces = MediaType.APPLICATION_JSON_VALUE)
@Tag(name = "Customer", description = "Perfil y direcciones del cliente autenticado.")
@SecurityRequirement(name = "bearerJwt")
public class CustomerController {

    private final CustomerService customerService;

    public CustomerController(CustomerService customerService) {
        this.customerService = customerService;
    }

    @GetMapping("/me")
    @Operation(summary = "Consultar mi perfil", description = "Devuelve el perfil asociado al sujeto del JWT.")
    @ApiResponse(responseCode = "200", description = "Perfil del cliente", content = @Content(schema = @Schema(implementation = CustomerProfileResponse.class)))
    @ApiResponse(responseCode = "401", description = "Autenticación inválida", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    public CustomerProfileResponse getProfile(@AuthenticationPrincipal Jwt jwt) {
        CustomerProfile profile = customerService.getProfile(actorUserId(jwt));
        return new CustomerProfileResponse(Long.toString(profile.customerId()), profile.email(), profile.firstNames(),
                profile.lastNames(), profile.phone(), profile.state(), Long.toString(profile.version()));
    }

    @PutMapping(path = "/me", consumes = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "Actualizar mi perfil", description = "Reemplaza nombres, apellidos y teléfono del cliente autenticado.")
    @ApiResponse(responseCode = "204", description = "Perfil actualizado")
    @ApiResponse(responseCode = "400", description = "Datos inválidos", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    public ResponseEntity<Void> updateProfile(@AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody ProfileUpdateRequest request) {
        customerService.updateProfile(actorUserId(jwt), Long.parseLong(request.expectedVersion()), request.firstNames(), request.lastNames(), request.phone());
        return ResponseEntity.noContent().build();
    }

    @PatchMapping(path = "/me", consumes = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "Editar un campo de mi perfil", description = "Actualiza únicamente field con value si expectedVersion coincide. null borra solo el teléfono. Un conflicto requiere revisar el perfil actual.")
    @ApiResponse(responseCode = "204", description = "Campo actualizado")
    @ApiResponse(responseCode = "409", description = "El perfil cambió", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    public ResponseEntity<Void> patchProfile(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody ProfilePatchRequest request) {
        customerService.patchProfile(actorUserId(jwt), Long.parseLong(request.expectedVersion()), request.field(), request.value());
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/me/addresses/attempts/{key}/resolve")
    @Operation(summary = "Resolver una creación de dirección", description = "PENDING conserva la incertidumbre; CREATED devuelve el identificador original; NOT_CREATED bloquea el intento tardío antes de confirmar ausencia.")
    @ApiResponse(responseCode = "200", description = "Resultado del intento", content = @Content(schema = @Schema(implementation = AddressAttemptResponse.class)))
    public AddressAttemptResponse resolveAddress(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID key) {
        var attempt = customerService.resolveAddress(actorUserId(jwt), key);
        return new AddressAttemptResponse(attempt.state(), attempt.addressId());
    }

    @PutMapping(path = "/me/email", consumes = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "Cambiar mi correo", description = "Cambia el correo de inicio de sesión del cliente autenticado tras confirmar su contraseña actual. Las sesiones abiertas siguen activas.")
    @ApiResponse(responseCode = "200", description = "Correo actualizado", content = @Content(schema = @Schema(implementation = EmailChangeResponse.class)))
    @ApiResponse(responseCode = "400", description = "Datos inválidos o contraseña actual incorrecta", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    @ApiResponse(responseCode = "409", description = "El correo ya pertenece a otra cuenta", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    public EmailChangeResponse changeEmail(@AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody EmailChangeRequest request) {
        return new EmailChangeResponse(customerService.changeEmail(actorUserId(jwt), request.newEmail(), request.currentPassword()));
    }

    @GetMapping("/me/addresses")
    @Operation(summary = "Listar mis direcciones")
    @ApiResponse(responseCode = "200", description = "Direcciones ordenadas según el contrato", content = @Content(array = @ArraySchema(schema = @Schema(implementation = CustomerAddressResponse.class))))
    public List<CustomerAddressResponse> listAddresses(@AuthenticationPrincipal Jwt jwt) {
        return customerService.listAddresses(actorUserId(jwt)).stream()
                .map(CustomerController::toResponse).toList();
    }

    @PostMapping(path = "/me/addresses", consumes = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "Crear una dirección")
    @ApiResponse(responseCode = "201", description = "Dirección creada", content = @Content(schema = @Schema(implementation = AddressCreatedResponse.class)))
    @ApiResponse(responseCode = "400", description = "Datos inválidos", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    public ResponseEntity<AddressCreatedResponse> createAddress(@AuthenticationPrincipal Jwt jwt,
            @RequestHeader("Idempotency-Key") UUID key,
            @Valid @RequestBody AddressRequest request) {
        long addressId = customerService.createAddress(actorUserId(jwt), key, addressData(request.alias(),
                request.recipient(), request.line1(), request.line2(), request.city(), request.province(),
                request.countryCode(), request.postalCode(), request.reference(), request.phone()),
                request.makePrimary());
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(new AddressCreatedResponse(Long.toString(addressId)));
    }

    @PutMapping(path = "/me/addresses/{addressId}", consumes = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "Reemplazar una dirección")
    @ApiResponse(responseCode = "204", description = "Dirección actualizada")
    @ApiResponse(responseCode = "404", description = "Dirección no disponible", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    public ResponseEntity<Void> updateAddress(@AuthenticationPrincipal Jwt jwt,
            @PathVariable @Positive(message = "El identificador de la dirección debe ser positivo.") long addressId,
            @Valid @RequestBody AddressUpdateRequest request) {
        customerService.updateAddress(actorUserId(jwt), addressId, addressData(request.alias(), request.recipient(),
                request.line1(), request.line2(), request.city(), request.province(), request.countryCode(),
                request.postalCode(), request.reference(), request.phone()));
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/me/addresses/{addressId}")
    @Operation(summary = "Eliminar una dirección")
    @ApiResponse(responseCode = "204", description = "Dirección eliminada")
    @ApiResponse(responseCode = "404", description = "Dirección no disponible", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    public ResponseEntity<Void> deleteAddress(@AuthenticationPrincipal Jwt jwt,
            @PathVariable @Positive(message = "El identificador de la dirección debe ser positivo.") long addressId) {
        customerService.deleteAddress(actorUserId(jwt), addressId);
        return ResponseEntity.noContent().build();
    }

    @PutMapping("/me/addresses/{addressId}/primary")
    @Operation(summary = "Establecer la dirección principal")
    @ApiResponse(responseCode = "204", description = "Dirección principal establecida")
    @ApiResponse(responseCode = "404", description = "Dirección no disponible", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    public ResponseEntity<Void> setPrimaryAddress(@AuthenticationPrincipal Jwt jwt,
            @PathVariable @Positive(message = "El identificador de la dirección debe ser positivo.") long addressId) {
        customerService.setPrimaryAddress(actorUserId(jwt), addressId);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/me/favorites")
    @Operation(summary = "Listar mis ediciones favoritas", description = "Devuelve una página de ediciones guardadas por el cliente, incluidas las que ya no están disponibles.")
    @ApiResponse(responseCode = "200", description = "Página de favoritos", content = @Content(schema = @Schema(implementation = FavoritePage.class)))
    @ApiResponse(responseCode = "400", description = "Paginación inválida", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    @ApiResponse(responseCode = "401", description = "Autenticación requerida", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    @ApiResponse(responseCode = "500", description = "Error interno", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    public PageResponse<Favorite> listFavorites(@AuthenticationPrincipal Jwt jwt,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(50) int pageSize) {
        CustomerFavorites.Page result = customerService.listFavorites(actorUserId(jwt), page, pageSize);
        List<Favorite> items = result.items().stream().map(CustomerController::toFavoriteResponse).toList();
        return new PageResponse<>(items, page, pageSize, Long.toString(result.totalCount()));
    }

    @GetMapping("/me/favorites/status")
    @Operation(summary = "Consultar favoritos de varias ediciones", description = "Devuelve si cada edición solicitada pertenece a los favoritos del cliente. Admite hasta 50 identificadores por petición.")
    @ApiResponse(responseCode = "200", description = "Estado favorito de cada edición", content = @Content(array = @ArraySchema(schema = @Schema(implementation = Status.class))))
    @ApiResponse(responseCode = "400", description = "Lista de ediciones inválida", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    @ApiResponse(responseCode = "401", description = "Autenticación requerida", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    @ApiResponse(responseCode = "500", description = "Error interno", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    public List<Status> favoriteStatus(@AuthenticationPrincipal Jwt jwt,
            @Parameter(required = true, description = "Entre 1 y 50 identificadores de edición positivos.")
            @RequestParam(required = false) @NotEmpty @Size(max = 50) List<@Positive Long> editionIds) {
        return customerService.favoriteStatus(actorUserId(jwt), editionIds).stream()
                .map(status -> new Status(Long.toString(status.editionId()), status.favorite())).toList();
    }

    @PutMapping("/me/favorites/{editionId}")
    @Operation(summary = "Agregar una edición a mis favoritos", description = "La operación es idempotente; solo guarda ediciones publicables del catálogo.")
    @ApiResponse(responseCode = "204", description = "Edición agregada o ya guardada")
    @ApiResponse(responseCode = "400", description = "Identificador inválido", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    @ApiResponse(responseCode = "401", description = "Autenticación requerida", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    @ApiResponse(responseCode = "404", description = "Edición no disponible", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    @ApiResponse(responseCode = "500", description = "Error interno", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    public ResponseEntity<Void> addFavorite(@AuthenticationPrincipal Jwt jwt,
            @PathVariable @Positive long editionId) {
        customerService.addFavorite(actorUserId(jwt), editionId);
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/me/favorites/{editionId}")
    @Operation(summary = "Quitar una edición de mis favoritos", description = "La operación es idempotente.")
    @ApiResponse(responseCode = "204", description = "Edición quitada o ya ausente")
    @ApiResponse(responseCode = "400", description = "Identificador inválido", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    @ApiResponse(responseCode = "401", description = "Autenticación requerida", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    @ApiResponse(responseCode = "500", description = "Error interno", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    public ResponseEntity<Void> removeFavorite(@AuthenticationPrincipal Jwt jwt,
            @PathVariable @Positive long editionId) {
        customerService.removeFavorite(actorUserId(jwt), editionId);
        return ResponseEntity.noContent().build();
    }

    private static long actorUserId(Jwt jwt) {
        return Long.parseLong(jwt.getSubject());
    }

    private static AddressInput addressData(String alias, String recipient, String line1, String line2,
            String city, String province, String countryCode, String postalCode, String reference, String phone) {
        return new AddressInput(alias, recipient, line1, line2, city, province, countryCode, postalCode,
                reference, phone);
    }

    private static CustomerAddressResponse toResponse(CustomerAddress address) {
        return new CustomerAddressResponse(Long.toString(address.addressId()), address.alias(), address.recipient(),
                address.line1(), address.line2(), address.city(), address.province(), address.countryCode(),
                address.postalCode(), address.reference(), address.phone(), address.primary());
    }

    private static Favorite toFavoriteResponse(CustomerFavorites.Favorite favorite) {
        return new Favorite(Long.toString(favorite.editionId()), Long.toString(favorite.bookId()),
                favorite.title(), favorite.authors(), favorite.publisher(),
                favorite.price().setScale(2, RoundingMode.UNNECESSARY).toPlainString(), favorite.coverUrl(),
                favorite.coverLicense(), favorite.coverAttribution(), favorite.format(), favorite.language(),
                favorite.available(), favorite.favoritedAt().toString());
    }
}
