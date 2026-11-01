package com.pliego.modules.notifications.gateway;
import com.pliego.modules.notifications.application.OutboxMail;
public interface MailOutboxGateway {
 OutboxMail claim();
 boolean prepareSend(OutboxMail mail);
 boolean complete(OutboxMail mail,String outcome,String error,String providerMessageId);
}
