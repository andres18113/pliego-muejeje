package com.pliego.modules.notifications.application;

/** Provider-independent boundary; callers never see provider request/response classes. */
@FunctionalInterface
public interface TransactionalMailSender {
 MailDeliveryReceipt send(String recipient,MailMessage message,String type,long outboxId);
}
