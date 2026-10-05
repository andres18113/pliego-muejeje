package com.pliego.modules.notifications.application;

/** Contains only a fixed outcome and sanitized code, never provider response data. */
public final class MailDeliveryException extends RuntimeException {
 private final String outcome;
 public MailDeliveryException(String outcome,String code) { super(code); this.outcome=outcome; }
 public String outcome() { return outcome; }
}
