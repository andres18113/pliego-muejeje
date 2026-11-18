package com.pliego.modules.library.gateway;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

import java.sql.ResultSet;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

import com.pliego.foundation.database.DatabaseExceptionTranslator;
import com.pliego.modules.library.application.LibraryModels;
import tools.jackson.databind.ObjectMapper;

@ExtendWith(MockitoExtension.class)
class JdbcLibraryGatewayTest {
    @Mock JdbcTemplate jdbc;
    @Mock ResultSet row;
    private final ObjectMapper mapper = new ObjectMapper();

    private static final String ITEM = """
            {"ownedItemId":"8","editionId":"42","coverUrl":null,"title":"Libro adquirido","authors":"Autora",
             "productType":"EBOOK","acquiredAt":"2026-10-05T10:00:00Z","ownershipState":"OWNED",
             "accessState":"OWNERSHIP_ONLY","contentAccessSupported":false,"metadata":null,
             "sourcePurchases":[
               {"orderId":"701","orderReference":"PL-0012-3401","orderItemId":"2","acquiredAt":"2026-10-06T10:00:00Z",
                "paymentState":"APPROVED","orderState":"CONFIRMED","grantState":"ACTIVE"},
               {"orderId":"700","orderReference":"PL-0123-4567","orderItemId":"1","acquiredAt":"2026-10-05T10:00:00Z",
                "paymentState":"REFUNDED","orderState":"CANCELLED","grantState":"REVOKED"}],
             "availableActions":[{"type":"VIEW_ORDER","label":"Ver pedido","href":"/orders/700"}]}
            """;

    @Test
    void list_preservesPublicReferencesBesideInternalIdsForEveryPurchase() throws Exception {
        when(row.getString("item")).thenReturn(ITEM);
        when(row.getLong("total_count")).thenReturn(1L);
        when(jdbc.query(contains("fn_customer_library("), any(RowMapper.class), eq(42L), eq(null), eq(0), eq(20)))
                .thenAnswer(call -> List.of(((RowMapper<?>) call.getArgument(1)).mapRow(row, 0)));

        var page = gateway().list(42L, null, 0, 20);

        assertThat(page.totalCount()).isEqualTo(1);
        assertPurchases(page.items().getFirst());
    }

    @Test
    void detail_preservesPublicReferencesForActiveAndRevokedPurchaseHistory() throws Exception {
        when(row.getString(1)).thenReturn(ITEM);
        when(jdbc.queryForObject(contains("fn_customer_library_detail("), any(RowMapper.class), eq(42L), eq(8L)))
                .thenAnswer(call -> ((RowMapper<?>) call.getArgument(1)).mapRow(row, 0));

        assertPurchases(gateway().detail(42L, 8L));
    }

    private JdbcLibraryGateway gateway() {
        return new JdbcLibraryGateway(new DatabaseExceptionTranslator(), jdbc, mapper);
    }

    private void assertPurchases(LibraryModels.Item item) {
        var sources = mapper.valueToTree(item).path("sourcePurchases");
        assertThat(sources.size()).isEqualTo(2);
        assertThat(sources.get(0).path("orderId").asString()).isEqualTo("701");
        assertThat(sources.get(0).path("orderReference").asString()).isEqualTo("PL-0012-3401");
        assertThat(sources.get(0).path("grantState").asString()).isEqualTo("ACTIVE");
        assertThat(sources.get(1).path("orderId").asString()).isEqualTo("700");
        assertThat(sources.get(1).path("orderReference").asString()).isEqualTo("PL-0123-4567");
        assertThat(sources.get(1).path("grantState").asString()).isEqualTo("REVOKED");
        assertThat(item.availableActions().getFirst().href()).isEqualTo("/orders/700");
    }
}
