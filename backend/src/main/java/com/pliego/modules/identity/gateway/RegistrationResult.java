package com.pliego.modules.identity.gateway;

public record RegistrationResult(long userId, long customerId, String state) {
}
