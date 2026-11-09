package com.pliego.modules.realtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import com.pliego.modules.realtime.application.RealtimeService;
import com.pliego.modules.realtime.application.RealtimeStreams;
import com.pliego.modules.realtime.gateway.RealtimeGateway;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;

@ExtendWith(MockitoExtension.class)
class RealtimeMetersTest {
    @Mock RealtimeService service;

    @Test
    void registrationAndRejectionsHaveOnlyBoundedTags() {
        var registry = new SimpleMeterRegistry();
        var streams = new RealtimeStreams(service, registry);
        try {
            for (String state : List.of("UNAUTHORIZED", "LIMITED", "a-sensitive-unexpected-state")) {
                when(service.connect(anyString(), any())).thenReturn(state);
                assertThatThrownBy(() -> streams.open("a".repeat(43), null))
                        .isInstanceOf(RealtimeStreams.OpenFailure.class);
            }
            assertThatThrownBy(() -> streams.open("invalid-cookie", null))
                    .isInstanceOf(RealtimeStreams.OpenFailure.class);
            when(service.connect(anyString(), any())).thenThrow(new IllegalStateException("synthetic"));
            assertThatThrownBy(() -> streams.open("b".repeat(43), 123456789L))
                    .isInstanceOf(IllegalStateException.class);

            assertThat(registry.get("pliego.sse.rejections").tag("reason", "unauthorized").counter().count()).isEqualTo(2);
            assertThat(registry.get("pliego.sse.rejections").tag("reason", "limited").counter().count()).isEqualTo(1);
            assertThat(registry.get("pliego.sse.rejections").tag("reason", "other").counter().count()).isEqualTo(2);
            assertThat(registry.get("pliego.sse.active").gauge().value()).isZero();
            assertThat(registry.getMeters()).hasSize(13);
            registry.getMeters().forEach(meter -> meter.getId().getTags().forEach(tag -> {
                assertThat(Set.of("reason", "resume", "kind")).contains(tag.getKey());
                assertThat(Set.of("limited", "unauthorized", "other", "true", "false", "event", "resync", "checkpoint", "heartbeat"))
                        .contains(tag.getValue());
            }));
        } finally { streams.shutdown(); }
    }

    @Test
    void activeOpensDeliveryAndClosesFollowExistingLifecycle() throws Exception {
        var registry = new SimpleMeterRegistry();
        var reading = new CountDownLatch(2);
        var disconnects = new CountDownLatch(2);
        when(service.connect(anyString(), any())).thenReturn("CONNECTED");
        when(service.read(any(), any())).thenAnswer(call -> {
            reading.countDown();
            return new RealtimeGateway.Batch(true, "2", true,
                    List.of(new RealtimeGateway.Event("2", "order.changed", "order", "private-id")));
        });
        doAnswer(call -> { disconnects.countDown(); return null; }).when(service).disconnect(any());
        var streams = new RealtimeStreams(service, registry);
        try {
            streams.open("a".repeat(43), null);
            streams.open("b".repeat(43), 1L);
            assertThat(reading.await(3, TimeUnit.SECONDS)).isTrue();
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(3);
            while (registry.get("pliego.sse.events").tag("kind", "event").counter().count() < 2
                    && System.nanoTime() < deadline) Thread.sleep(10);
            assertThat(registry.get("pliego.sse.active").gauge().value()).isEqualTo(2);
            assertThat(registry.get("pliego.sse.opens").tag("resume", "false").counter().count()).isEqualTo(1);
            assertThat(registry.get("pliego.sse.opens").tag("resume", "true").counter().count()).isEqualTo(1);
            assertThat(registry.get("pliego.sse.events").tag("kind", "event").counter().count()).isGreaterThanOrEqualTo(2);
            assertThat(registry.get("pliego.sse.events").tag("kind", "resync").counter().count()).isGreaterThanOrEqualTo(2);
            assertThat(registry.get("pliego.sse.events").tag("kind", "heartbeat").counter().count()).isEqualTo(2);
            assertThat(registry.get("pliego.sse.batch.events").summary().max()).isEqualTo(1);
            streams.shutdown();
            assertThat(disconnects.await(3, TimeUnit.SECONDS)).isTrue();
            assertThat(registry.get("pliego.sse.active").gauge().value()).isZero();
            assertThat(registry.get("pliego.sse.closes").counter().count()).isEqualTo(2);
            streams.shutdown();
            assertThat(registry.get("pliego.sse.closes").counter().count()).isEqualTo(2);
        } finally { streams.shutdown(); }
    }

    @Test
    void readPermitTimeoutRecordsDeferralWithoutReading() throws Exception {
        var registry = new SimpleMeterRegistry();
        var firstRead = new CountDownLatch(1);
        when(service.connect(anyString(), any())).thenReturn("CONNECTED");
        when(service.read(any(), any())).thenAnswer(call -> {
            firstRead.countDown();
            return new RealtimeGateway.Batch(true, "0", false, List.of());
        });
        var streams = new RealtimeStreams(service, registry);
        var permits = (Semaphore) ReflectionTestUtils.getField(streams, "database");
        try {
            streams.open("a".repeat(43), null);
            assertThat(firstRead.await(3, TimeUnit.SECONDS)).isTrue();
            permits.acquire(4);
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(7);
            while (registry.get("pliego.sse.reads.deferred").counter().count() == 0
                    && System.nanoTime() < deadline) Thread.sleep(10);
            assertThat(registry.get("pliego.sse.reads.deferred").counter().count()).isGreaterThanOrEqualTo(1);
        } finally { permits.release(4); streams.shutdown(); }
    }
}
