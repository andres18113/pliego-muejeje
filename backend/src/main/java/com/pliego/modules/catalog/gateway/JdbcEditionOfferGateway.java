package com.pliego.modules.catalog.gateway;

import java.sql.PreparedStatement;
import java.sql.Types;
import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import com.pliego.foundation.database.DatabaseExceptionTranslator;
import com.pliego.foundation.database.JdbcGatewaySupport;
import com.pliego.modules.catalog.application.EditionOfferCommand;
import com.pliego.modules.catalog.application.EditionOfferPrecondition;

@Repository
public class JdbcEditionOfferGateway extends JdbcGatewaySupport implements EditionOfferGateway {
    private final JdbcTemplate jdbc;
    public JdbcEditionOfferGateway(DatabaseExceptionTranslator translator, JdbcTemplate jdbc) {
        super(translator); this.jdbc = jdbc;
    }
    @Override
    public void set(long actorId, long editionId, EditionOfferCommand command) {
        withDatabaseErrorTranslation(() -> jdbc.execute((ConnectionCallback<Void>) connection -> {
            try (PreparedStatement statement = connection.prepareStatement("CALL pliego.sp_edition_offer_set(?,?,?,?,?,?,?,?)")) {
                statement.setLong(1, actorId); statement.setLong(2, editionId);
                statement.setBigDecimal(3, command.offerPrice());
                statement.setObject(4, command.startsAt()); statement.setObject(5, command.endsAt());
                statement.setString(6, command.offerCopy()); statement.setString(7, command.terms());
                statement.setNull(8, Types.BIGINT);
                statement.execute();
                return null;
            }
        }));
    }
    @Override
    public void createIfAbsent(long actorId, long editionId, EditionOfferCommand command,
            EditionOfferPrecondition precondition) {
        withDatabaseErrorTranslation(() -> jdbc.execute((ConnectionCallback<Void>) connection -> {
            try (PreparedStatement statement = connection.prepareStatement("CALL pliego.sp_edition_offer_create_if_absent(?,?,?,?,?,?,?,?,?,?,?)")) {
                statement.setLong(1, actorId); statement.setLong(2, editionId);
                statement.setBigDecimal(3, precondition.expectedBasePrice());
                statement.setString(4, precondition.expectedStock()); statement.setString(5, precondition.ifNoneMatch());
                statement.setBigDecimal(6, command.offerPrice());
                statement.setObject(7, command.startsAt()); statement.setObject(8, command.endsAt());
                statement.setString(9, command.offerCopy()); statement.setString(10, command.terms());
                statement.setNull(11, Types.BIGINT);
                statement.execute();
                return null;
            }
        }));
    }
    @Override
    public void clear(long actorId, long editionId) {
        withDatabaseErrorTranslation(() -> jdbc.execute((ConnectionCallback<Void>) connection -> {
            try (PreparedStatement statement = connection.prepareStatement("CALL pliego.sp_edition_offer_clear(?,?)")) {
                statement.setLong(1, actorId); statement.setLong(2, editionId); statement.execute(); return null;
            }
        }));
    }
}
