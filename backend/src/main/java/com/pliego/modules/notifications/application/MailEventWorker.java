package com.pliego.modules.notifications.application;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class MailEventWorker {
 private static final Logger LOG=LoggerFactory.getLogger(MailEventWorker.class);
 private final MailEventService service;
 private final MailtrapWebhookProperties properties;
 public MailEventWorker(MailEventService service,MailtrapWebhookProperties properties) {this.service=service;this.properties=properties;}
 @Scheduled(fixedDelay=5000,initialDelay=5000)
 public void process() {
  if(!properties.enabled())return;
  try {for(int i=0;i<500&&service.projectNext();i++) { /* one committed event per transaction */ }}
  catch(RuntimeException e) {LOG.warn("mail_event state=PROJECTION_FAILED code=DATABASE_ERROR");}
 }
}
