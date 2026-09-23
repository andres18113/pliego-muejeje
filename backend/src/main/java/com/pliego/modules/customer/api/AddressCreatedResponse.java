package com.pliego.modules.customer.api;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(name = "AddressCreated")
public record AddressCreatedResponse(@Schema(example = "15") String addressId) {
}
