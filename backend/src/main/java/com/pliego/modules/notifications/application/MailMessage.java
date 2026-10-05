package com.pliego.modules.notifications.application;

public record MailMessage(String subject,String html,String text) {
 @Override public String toString() { return "MailMessage[REDACTED]"; }
}
