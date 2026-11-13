package com.pliego.modules.notifications.application;

import java.time.Instant;

/** Sanitized provider outcome. Never retains SMTP text or webhook recipient. */
public record MailProviderEvent(String eventId,String messageId,String status,String reason,Instant occurredAt) {}
