package com.pliego.modules.notifications.application;

import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.annotation.Propagation;
import com.pliego.modules.notifications.gateway.MailEventGateway;

@Service
public class MailEventService {
 private final MailEventGateway gateway;
 public MailEventService(MailEventGateway gateway) {this.gateway=gateway;}
 @Transactional
 public boolean record(List<MailProviderEvent> events) {
  for(var event:events)if(!gateway.record(event))throw new ConflictingEventException();
  return true;
 }
 @Transactional(propagation=Propagation.REQUIRES_NEW)
 public boolean projectNext() {return gateway.projectNext();}
 public static final class ConflictingEventException extends RuntimeException {}
}
