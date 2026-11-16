package com.pliego.modules.catalog.application;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

import java.math.BigDecimal;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.pliego.modules.catalog.gateway.OfferLifecycleGateway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.slf4j.LoggerFactory;

@ExtendWith(MockitoExtension.class)
class OfferLifecycleSchedulerTest {
    @Mock OfferLifecycleGateway gateway;

    @Test
    void databaseFailure_recordsAStableCode_andDoesNotStopFutureScheduling() {
        when(gateway.advance(1000)).thenThrow(new IllegalStateException("sensitive database details"));
        var scheduler = new OfferLifecycleScheduler(new OfferLifecycleService(gateway));
        assertThatCode(scheduler::advance).doesNotThrowAnyException();
        verify(gateway).failure("DATABASE_ERROR");
    }

    @Test
    void failureRecordingError_isBestEffort_andDoesNotStopFutureScheduling() {
        when(gateway.advance(1000)).thenThrow(new IllegalStateException("database unavailable"));
        doThrow(new IllegalStateException("database still unavailable")).when(gateway).failure("DATABASE_ERROR");
        var scheduler = new OfferLifecycleScheduler(new OfferLifecycleService(gateway));
        assertThatCode(scheduler::advance).doesNotThrowAnyException();
    }

    @Test
    void committedTransitions_logTheirCountAndLag() {
        when(gateway.advance(1000)).thenReturn(new OfferLifecycleAdvance("OK", 2, new BigDecimal("5.25")));
        var scheduler = new OfferLifecycleScheduler(new OfferLifecycleService(gateway));
        var logger = (Logger) LoggerFactory.getLogger(OfferLifecycleScheduler.class);
        var events = new ListAppender<ILoggingEvent>();
        events.start();
        logger.addAppender(events);
        try {
            scheduler.advance();
            assertThat(events.list).extracting(ILoggingEvent::getFormattedMessage)
                    .contains("offer_lifecycle state=OK transitionCount=2 maxLagSeconds=5.25");
        } finally {
            logger.detachAppender(events);
            events.stop();
        }
    }
}
