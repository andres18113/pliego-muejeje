package com.pliego.modules.sales.application;

public record CheckoutAttempt(String state, CheckoutResult order) { }
