package com.pliego.modules.notifications.application;

/** Provider-independent boundary; callers never see provider request/response classes. */
@FunctionalInterface
public interface TransactionalMailSender {
 void send(String recipient,MailMessage message,String type);
}
