package com.pliego.modules.notifications.application;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

@Configuration
@EnableConfigurationProperties({MailProperties.class,MailtrapWebhookProperties.class})
@EnableScheduling
public class MailConfiguration {
}
