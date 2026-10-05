package com.pliego.modules.notifications.gateway;
import com.pliego.modules.notifications.application.OutboxMail;
public interface MailOutboxGateway {
 OutboxMail claim();
 void complete(OutboxMail mail,String outcome,String error);
}
