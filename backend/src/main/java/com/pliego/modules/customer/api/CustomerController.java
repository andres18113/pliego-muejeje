package com.pliego.modules.customer.api;

import java.util.List;

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
import org.springframework.web.bind.annotation.RestController;

import com.pliego.foundation.web.ProblemResponse;
import com.pliego.modules.customer.application.AddressInput;
import com.pliego.modules.customer.application.CustomerAddress;
import com.pliego.modules.customer.application.CustomerProfile;
import com.pliego.modules.customer.application.CustomerService;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.ArraySchema;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Positive;

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
                profile.lastNames(), profile.phone(), profile.state());
    }

    @PutMapping(path = "/me", consumes = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "Actualizar mi perfil", description = "Reemplaza nombres, apellidos y teléfono del cliente autenticado.")
    @ApiResponse(responseCode = "204", description = "Perfil actualizado")
    @ApiResponse(responseCode = "400", description = "Datos inválidos", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    public ResponseEntity<Void> updateProfile(@AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody ProfileUpdateRequest request) {
        customerService.updateProfile(actorUserId(jwt), request.firstNames(), request.lastNames(), request.phone());
        return ResponseEntity.noContent().build();
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
            @Valid @RequestBody AddressRequest request) {
        long addressId = customerService.createAddress(actorUserId(jwt), addressData(request.alias(),
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
}
