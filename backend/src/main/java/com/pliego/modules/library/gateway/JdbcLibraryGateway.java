package com.pliego.modules.library.gateway;

import com.pliego.foundation.database.DatabaseExceptionTranslator;
import com.pliego.foundation.database.JdbcGatewaySupport;
import com.pliego.modules.library.application.LibraryModels;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.core.JacksonException;
import java.sql.SQLException;
import java.util.List;

/** Calls the ownership Database API; never reconstructs purchase/access rules in Java. */
@Repository
public class JdbcLibraryGateway extends JdbcGatewaySupport implements LibraryGateway {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    public JdbcLibraryGateway(DatabaseExceptionTranslator translator,JdbcTemplate jdbc,ObjectMapper mapper) {
        super(translator); this.jdbc=jdbc; this.mapper=mapper;
    }
    private record Row(LibraryModels.Item item,long totalCount) { }
    private List<Row> rows(long actor,String type,int page,int size) {
        return jdbc.query("SELECT item::text,total_count FROM pliego.fn_customer_library(?,?,?,?)",
            (rs,n)->new Row(parse(rs.getString("item")),rs.getLong("total_count")),actor,type,page,size);
    }
    @Override public LibraryModels.Page list(long actor,String type,int page,int size) {
        return withDatabaseErrorTranslation(()->{
            var rows=rows(actor,type,page,size);
            long total=rows.isEmpty()?0:rows.getFirst().totalCount();
            if(rows.isEmpty() && page>0) { var first=rows(actor,type,0,size); total=first.isEmpty()?0:first.getFirst().totalCount(); }
            return new LibraryModels.Page(rows.stream().map(Row::item).toList(),total);
        });
    }
    @Override public LibraryModels.Item detail(long actor,long owned) {
        return withDatabaseErrorTranslation(()->jdbc.queryForObject(
            "SELECT pliego.fn_customer_library_detail(?,?)::text",(rs,n)->parse(rs.getString(1)),actor,owned));
    }
    private LibraryModels.Item parse(String json) throws SQLException {
        try { return mapper.readValue(json,LibraryModels.Item.class); }
        catch(JacksonException error) { throw new SQLException("Invalid library Database API projection","XX000",error); }
    }
}
