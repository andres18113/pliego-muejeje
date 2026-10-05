package com.pliego.modules.notifications.application;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

@Component
@ConditionalOnProperty(name="pliego.mail.enabled",havingValue="true")
public class MailOutboxWorker {
 private static final Logger LOG=LoggerFactory.getLogger(MailOutboxWorker.class);
 private final MailOutboxService outbox;
 private final TransactionalMailSender sender;
 private final MailTemplates templates;
 private final MailProperties properties;
 private final ObjectMapper json;
 public MailOutboxWorker(MailOutboxService outbox,TransactionalMailSender sender,MailTemplates templates,MailProperties properties,ObjectMapper json) {
  this.outbox=outbox;this.sender=sender;this.templates=templates;this.properties=properties;this.json=json;
 }
 @Scheduled(fixedDelayString="${pliego.mail.poll-interval:PT10S}",initialDelayString="${pliego.mail.poll-interval:PT10S}")
 public void process() {
  for(int i=0;i<properties.batchSize();i++) {
   OutboxMail mail;
   try {mail=outbox.claim();} catch(RuntimeException e) {LOG.warn("mail_outbox state=CLAIM_FAILED code=DATABASE_ERROR");return;}
   if(mail==null)return;
   String outcome="SENT";String error=null;
   try { sender.send(mail.recipient(),templates.render(mail.type(),json.readTree(mail.data())),mail.type()); }
   catch(MailDeliveryException e) {outcome=e.outcome();error=e.getMessage();}
   catch(RuntimeException e) {outcome="FAILED";error="MAIL_RENDER_ERROR";}
   try {
    outbox.complete(mail,outcome,error);
    String state="SENT".equals(outcome)?"SENT":("RETRY".equals(outcome)&&mail.attempts()<5?"PENDING":"FAILED");
    LOG.info("mail_outbox id={} type={} state={} attempts={} code={}",mail.id(),mail.type(),state,mail.attempts(),error);
   } catch(RuntimeException e) {LOG.warn("mail_outbox id={} type={} state=COMPLETION_FAILED attempts={} code=DATABASE_ERROR",mail.id(),mail.type(),mail.attempts());return;}
  }
 }
}
