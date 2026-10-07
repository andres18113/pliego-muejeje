package com.pliego.modules.notifications.application;

/** Provider acceptance receipt; it contains no recipient or message content. */
public record MailDeliveryReceipt(String providerMessageId) {
 public MailDeliveryReceipt {
  if(providerMessageId==null||!providerMessageId.matches("[A-Za-z0-9._:-]{1,128}"))
   throw new IllegalArgumentException("Identificador de mensaje del proveedor inválido.");
 }
 @Override public String toString() { return "MailDeliveryReceipt[providerMessageId=REDACTED]"; }
}
