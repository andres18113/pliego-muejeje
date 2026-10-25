package com.pliego.modules.customer.api;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import com.pliego.modules.library.application.DigitalEligibility;
import com.pliego.modules.library.gateway.DigitalEligibilityGateway;
import org.junit.jupiter.api.Test;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/** Same Spring/security/transaction fixture as the customer batch status endpoints. */
class DigitalEligibilityApiIntegrationTest extends CustomerApiIntegrationTest {
    @MockitoBean DigitalEligibilityGateway eligibilityGateway;

    private String auth(String actor, String role) {
        var now = Instant.now();
        return "Bearer " + tokenIssuer.issue(actor, role, now, now.plusSeconds(1800), UUID.randomUUID().toString());
    }

    @Test
    void batchUsesAuthenticatedCustomerAndPreservesLibraryLink() throws Exception {
        when(eligibilityGateway.get(20, List.of(3L, 4L))).thenReturn(List.of(
                new DigitalEligibility("3", true, "800", false, null, false, false),
                new DigitalEligibility("4", false, null, true, "900", true, false)));
        mvc.perform(get("/api/v1/me/digital-eligibility?editionIds=3,4&actorUserId=10")
                        .header("Authorization", auth("20", "CUSTOMER")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].editionId").value("3"))
                .andExpect(jsonPath("$[0].owned").value(true))
                .andExpect(jsonPath("$[0].ownedItemId").value("800"))
                .andExpect(jsonPath("$[0].pendingOrderId").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$[1].pendingOrderId").value("900"))
                .andExpect(jsonPath("$[1].pendingOrder").value(true))
                .andExpect(jsonPath("$[1].inCart").value(true))
                .andExpect(jsonPath("$[1].purchasable").value(false));
        verify(eligibilityGateway).get(20, List.of(3L, 4L));
        verifyNoMoreInteractions(eligibilityGateway);
    }

    @Test
    void batchRejectsMissingNonpositiveAndOversizedLists() throws Exception {
        for (String query : List.of("", "?editionIds=0", "?editionIds=-1", "?editionIds=" + "3,".repeat(50) + "3")) {
            mvc.perform(get("/api/v1/me/digital-eligibility" + query)
                            .header("Authorization", auth("20", "CUSTOMER")))
                    .andExpect(status().isBadRequest());
        }
        verifyNoInteractions(eligibilityGateway);
    }

    @Test
    void customerAuthenticationIsRequired() throws Exception {
        mvc.perform(get("/api/v1/me/digital-eligibility?editionIds=3")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/me/digital-eligibility?editionIds=3")
                        .header("Authorization", auth("20", "ADMIN"))).andExpect(status().isForbidden());
        verifyNoInteractions(eligibilityGateway);
    }
}
