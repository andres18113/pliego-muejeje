package com.pliego.modules.sales.gateway;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.PreparedStatementSetter;
import org.springframework.jdbc.core.RowMapper;

import com.pliego.foundation.database.DatabaseExceptionTranslator;
import com.pliego.modules.sales.application.PickupModels;
import tools.jackson.databind.ObjectMapper;

@ExtendWith(MockitoExtension.class)
class PickupGatewayTest {
    @Mock JdbcTemplate jdbc;
    @Mock ResultSet row;
    @Mock PreparedStatement statement;
    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    // AC-2.2 AC-2.3 AC-2.4
    void lookup_mapsTheDatabaseProjectionWithoutPickupCredentialsOrNumericIdLoss() throws Exception {
        when(row.getString("pickup")).thenReturn(projection());
        when(jdbc.queryForObject(anyString(), any(RowMapper.class), eq(7L), eq("p-ab234567")))
                .thenAnswer(call -> ((RowMapper<?>) call.getArgument(1)).mapRow(row, 0));
        var result = gateway().lookup(7L, "p-ab234567");
        assertThat(result.orderId()).isEqualTo("9007199254740993");
        assertThat(result.customer().identityNumber()).isNull();
        assertThat(result.total()).isEqualByComparingTo("39.80");
        assertThat(result.items()).extracting(PickupModels.Item::format).containsExactly("PAPERBACK");
        assertThat(mapper.writeValueAsString(result)).doesNotContain("pickupCode", "AB234567");
    }

    @Test
    void search_recoversTotalCountOnEmptyLaterPageUsingTheSameFilteredDatabaseApi() throws Exception {
        when(row.getString("pickup")).thenReturn(projection());
        when(row.getLong("total_count")).thenReturn(23L);
        when(jdbc.query(anyString(), any(PreparedStatementSetter.class), any(RowMapper.class)))
                .thenAnswer(call -> {
                    ((PreparedStatementSetter) call.getArgument(1)).setValues(statement);
                    return List.of();
                })
                .thenAnswer(call -> {
                    ((PreparedStatementSetter) call.getArgument(1)).setValues(statement);
                    return List.of(((RowMapper<?>) call.getArgument(2)).mapRow(row, 0));
                });
        var page = gateway().search(7L, new PickupModels.Search("READY", "#pl01234567", 9, 20));
        assertThat(page.items()).isEmpty();
        assertThat(page.totalCount()).isEqualTo(23);
        verify(statement, org.mockito.Mockito.times(2)).setString(2, "READY");
        verify(statement, org.mockito.Mockito.times(2)).setString(3, "#pl01234567");
        verify(statement).setInt(4, 9);
        verify(statement).setInt(4, 0);
    }

    @Test
    // AC-4.3
    void collect_passesExplicitIdentityVerificationToTheApprovedFourArgumentCommand() {
        gateway().collect(7L, 700L, "P-AB234567", true);
        verify(jdbc).update("CALL pliego.sp_pickup_collect(?,?,?,?)", 7L, 700L, "P-AB234567", true);
    }

    @Test
    // AC-2.4 AC-3.2 AC-3.3 AC-8.1
    void detailAndVerificationMapDatabaseCapabilitiesAndOnlyCallTheirApprovedRoutines() throws Exception {
        String json = projection().stripTrailing();
        when(row.getString("pickup")).thenReturn(json.substring(0, json.length() - 1)
                + ",\"paymentMethod\":null,\"availableActions\":{\"cancel\":false,\"cancellationDeadline\":null}}");
        when(jdbc.queryForObject(anyString(), any(RowMapper.class), eq(7L), eq(700L)))
                .thenAnswer(call -> ((RowMapper<?>) call.getArgument(1)).mapRow(row, 0));
        var detail = gateway().handoverDetail(7L, 700L);
        assertThat(detail.availableActions().cancel()).isFalse();
        assertThat(detail.availableActions().cancellationDeadline()).isNull();
        assertThat(detail.paymentMethod()).isNull();
        when(jdbc.queryForObject(anyString(), any(RowMapper.class), eq(7L), eq(700L), eq("p-ab234567")))
                .thenAnswer(call -> ((RowMapper<?>) call.getArgument(1)).mapRow(row, 0));
        assertThat(gateway().verifyCode(7L, 700L, "p-ab234567")).isEqualTo(detail);
        verify(jdbc).queryForObject(eq("SELECT pliego.fn_admin_pickup_handover_detail(?,?)::text AS pickup"),
                any(RowMapper.class), eq(7L), eq(700L));
        verify(jdbc).queryForObject(eq("SELECT pliego.fn_admin_pickup_verify_code(?,?,?)::text AS pickup"),
                any(RowMapper.class), eq(7L), eq(700L), eq("p-ab234567"));
        org.mockito.Mockito.verifyNoMoreInteractions(jdbc);
        assertThat(mapper.writeValueAsString(detail)).doesNotContain("pickupCode", "AB234567");
    }

    private JdbcPickupLocationGateway gateway() {
        return new JdbcPickupLocationGateway(new DatabaseExceptionTranslator(), jdbc, mapper);
    }

    private static String projection() {
        return """
                {"orderId":"9007199254740993","orderReference":"PL-0123-4567","state":"READY",
                 "orderState":"CONFIRMED","paymentState":"APPROVED","createdAt":"2026-11-01T14:00:00Z",
                 "readyAt":"2026-11-01T15:00:00Z","collectedAt":null,"collectedBy":null,"identityVerified":null,
                 "location":{"id":"1","name":"Centro","address":"Principal","city":"Quito"},
                 "customer":{"customerId":"42","name":"Ana","email":"ana@example.test","identityType":null,"identityNumber":null},
                 "items":[{"orderItemId":"800","title":"Impreso","format":"PAPERBACK","quantity":2}],
                 "unitCount":2,"total":39.80}
                """;
    }
}
