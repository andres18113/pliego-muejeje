package com.pliego.modules.notifications.application;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

@Configuration
@EnableConfigurationProperties(MailProperties.class)
public class MailConfiguration {
 @Configuration
 @EnableScheduling
 @ConditionalOnProperty(name="pliego.mail.enabled",havingValue="true")
 static class Scheduling {}
}
