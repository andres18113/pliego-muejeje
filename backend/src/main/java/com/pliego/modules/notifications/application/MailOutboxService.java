package com.pliego.modules.notifications.application;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import com.pliego.modules.notifications.gateway.MailOutboxGateway;

@Service
public class MailOutboxService {
 private final MailOutboxGateway gateway;
 public MailOutboxService(MailOutboxGateway gateway) {this.gateway=gateway;}
 @Transactional(propagation=Propagation.REQUIRES_NEW)
 public OutboxMail claim() {return gateway.claim();}
 @Transactional(propagation=Propagation.REQUIRES_NEW)
 public void complete(OutboxMail mail,String outcome,String error) {gateway.complete(mail,outcome,error);}
}
