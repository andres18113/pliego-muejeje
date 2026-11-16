package com.pliego.modules.notifications.gateway;
import com.pliego.modules.notifications.application.MailProviderEvent;

public interface MailEventGateway {
 boolean record(MailProviderEvent event);
 boolean projectNext();
}
