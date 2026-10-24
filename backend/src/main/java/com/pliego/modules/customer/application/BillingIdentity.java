package com.pliego.modules.customer.application;

/** Own-profile projection. Never include the number in diagnostic output. */
public record BillingIdentity(String type, String number) {
    @Override public String toString() { return "BillingIdentity[redacted]"; }
}
