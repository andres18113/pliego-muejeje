package com.pliego.modules.library.application;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(name = "DigitalEligibility")
public record DigitalEligibility(
        String editionId,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED) boolean owned,
        @Schema(nullable = true, description = "Identificador de Mi biblioteca para /biblioteca/{id}; null si no tiene un grant activo.") String ownedItemId,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED) boolean pendingOrder,
        @Schema(nullable = true, description = "Pedido digital abierto para /orders/{id}; null sin pedido bloqueante. Si hay varios históricos, devuelve el menor ID.") String pendingOrderId,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED) boolean inCart,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED,
                description = "Edición digital activa sin propiedad ni pedido abierto. Estar en el carrito no impide comprar. Checkout vuelve a validar dentro de su transacción.") boolean purchasable) { }
