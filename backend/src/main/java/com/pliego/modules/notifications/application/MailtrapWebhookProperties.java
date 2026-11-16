package com.pliego.modules.notifications.application;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("pliego.mail.webhook")
public record MailtrapWebhookProperties(String secret) {
 public MailtrapWebhookProperties {
  if(secret==null) secret="";
  if(!secret.isEmpty()&&!secret.matches("[0-9a-fA-F]{32}"))
   throw new IllegalArgumentException("Configura un secreto de webhook Mailtrap válido.");
 }
 public boolean enabled() {return !secret.isEmpty();}
 @Override public String toString() {return "MailtrapWebhookProperties[secret=REDACTED]";}
}
