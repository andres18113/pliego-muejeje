package com.pliego.modules.sales.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.when;

import java.math.BigDecimal;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import com.pliego.modules.sales.gateway.PickupLocationGateway;

@ExtendWith(MockitoExtension.class)
class PickupServiceTest {
    @Mock PickupLocationGateway gateway;
    @InjectMocks PickupService service;

    @Test
    // AC-3.3
    void verificationUsesOnlyTheReadOnlyGateway() throws Exception {
        service.verifyCode(7L, 700L, "p-ab234567");
        org.mockito.Mockito.verify(gateway).verifyCode(7L, 700L, "p-ab234567");
        org.mockito.Mockito.verifyNoMoreInteractions(gateway);
        assertThat(PickupService.class.getMethod("verifyCode", long.class, long.class, String.class)
                .getAnnotation(org.springframework.transaction.annotation.Transactional.class).readOnly()).isTrue();
    }

    @Test
    // AC-2.1 AC-8.1
    void detailDelegatesDatabaseAvailabilityAndReconciliation() {
        service.detail(7L, 700L);
        org.mockito.Mockito.verify(gateway).handoverDetail(7L, 700L);
        org.mockito.Mockito.verifyNoMoreInteractions(gateway);
    }

    @Test
    // AC-5.2
    void collect_readsUpdatedCodeFreeProjectionOnlyAfterTheVerifiedCommand() {
        var projection = new PickupModels.View("700", "PL-0123-4567", "COLLECTED", "DELIVERED", "APPROVED",
                "2026-11-01T14:00:00Z", "2026-11-01T15:00:00Z", "2026-11-01T15:05:00Z",
                new PickupModels.CollectedBy("7", "admin@example.test"), true,
                new PickupModels.Location("1", "Centro", "Principal", "Quito"),
                new PickupModels.Customer("42", "Ana", "ana@example.test", null, null),
                List.of(new PickupModels.Item("800", "Impreso", "PAPERBACK", 2)), 2, new BigDecimal("39.80"));
        when(gateway.detail(7L, 700L)).thenReturn(projection);
        assertThat(service.collect(7L, 700L, "P-AB234567", true)).isEqualTo(projection);
        var commands = inOrder(gateway);
        commands.verify(gateway).collect(7L, 700L, "P-AB234567", true);
        commands.verify(gateway).detail(7L, 700L);
    }
}
