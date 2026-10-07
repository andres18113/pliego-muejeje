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
 @Scheduled(fixedDelayString="${pliego.mail.poll-interval:PT30S}",initialDelayString="${pliego.mail.poll-interval:PT30S}")
 public void process() {
  for(int i=0;i<properties.batchSize();i++) {
   OutboxMail mail;
   try {mail=outbox.claim();} catch(RuntimeException e) {LOG.warn("mail_outbox state=CLAIM_FAILED code=DATABASE_ERROR");return;}
   if(mail==null)return;
   String outcome="SENT";String error=null;String providerMessageId=null;
   try {
    MailDeliveryReceipt receipt=sender.send(mail.recipient(),templates.render(mail.type(),json.readTree(mail.data())),mail.type(),mail.id());
    providerMessageId=receipt.providerMessageId();
   }
   catch(MailDeliveryException e) {outcome=e.outcome();error=e.getMessage();}
   catch(RuntimeException e) {outcome="FAILED";error="MAIL_RENDER_ERROR";}
   try {
    if(!outbox.complete(mail,outcome,error,providerMessageId)) {
     LOG.warn("mail_outbox id={} type={} state=STALE_COMPLETION attempts={} provider_message_id={} code=LEASE_REPLACED",mail.id(),mail.type(),mail.attempts(),providerMessageId);
     continue;
    }
    String state="SENT".equals(outcome)?"SENT":("RETRY".equals(outcome)&&mail.attempts()<5?"PENDING":"FAILED");
    LOG.info("mail_outbox id={} type={} state={} attempts={} provider_message_id={} code={}",mail.id(),mail.type(),state,mail.attempts(),providerMessageId,error);
   } catch(RuntimeException e) {LOG.warn("mail_outbox id={} type={} state=COMPLETION_FAILED attempts={} provider_message_id={} code=DATABASE_ERROR",mail.id(),mail.type(),mail.attempts(),providerMessageId);return;}
  }
 }
}
