package com.pliego.modules.realtime.application;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name="pliego.realtime.enabled",havingValue="true",matchIfMissing=true)
public class RealtimePublisher {
 private static final Logger LOG=LoggerFactory.getLogger(RealtimePublisher.class);
 private final RealtimeService service;
 public RealtimePublisher(RealtimeService service){this.service=service;}
 @Scheduled(fixedDelay=2000,initialDelay=2000)
 public void publish(){try{service.publish();}catch(RuntimeException e){LOG.warn("realtime state=PUBLISH_FAILED code=DATABASE_ERROR");}}
 @Configuration @EnableScheduling
 @ConditionalOnProperty(name="pliego.realtime.enabled",havingValue="true",matchIfMissing=true)
 static class Scheduling {}
}
