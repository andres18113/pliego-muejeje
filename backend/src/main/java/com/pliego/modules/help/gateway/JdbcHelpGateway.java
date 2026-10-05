package com.pliego.modules.help.gateway;

import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import com.pliego.foundation.database.DatabaseExceptionTranslator;
import com.pliego.foundation.database.JdbcGatewaySupport;
import com.pliego.modules.help.application.*;

@Repository
public class JdbcHelpGateway extends JdbcGatewaySupport implements HelpGateway {
    private final JdbcTemplate jdbc;
    public JdbcHelpGateway(DatabaseExceptionTranslator translator,JdbcTemplate jdbc) { super(translator); this.jdbc = jdbc; }
    @Override public List<HelpCategory> categories() {
        return withDatabaseErrorTranslation(() -> jdbc.query("SELECT * FROM pliego.fn_help_categories()", (rs,row) ->
                new HelpCategory(rs.getString("slug"),rs.getString("title"),rs.getInt("position"),rs.getString("applicability"))));
    }
    private record SearchRow(HelpArticleSummary item,long totalCount) { }
    private List<SearchRow> rows(String query,String category,String applicability,int page,int pageSize) {
        return jdbc.query("SELECT * FROM pliego.fn_help_search(?,?,?,?,?)", (rs,row) -> new SearchRow(
                new HelpArticleSummary(rs.getString("slug"),rs.getString("category_slug"),rs.getString("title"),
                        rs.getString("summary"),rs.getInt("position"),rs.getString("applicability")),rs.getLong("total_count")),
                query,category,applicability,page,pageSize);
    }
    @Override public HelpSearchPage search(String query,String category,String applicability,int page,int pageSize) {
        return withDatabaseErrorTranslation(() -> {
            List<SearchRow> results = rows(query,category,applicability,page,pageSize);
            long total = results.isEmpty() ? 0 : results.getFirst().totalCount();
            if (results.isEmpty() && page>0) {
                List<SearchRow> first = rows(query,category,applicability,0,pageSize);
                total = first.isEmpty() ? 0 : first.getFirst().totalCount();
            }
            return new HelpSearchPage(results.stream().map(SearchRow::item).toList(),total);
        });
    }
    @Override public Optional<HelpArticle> article(String slug) {
        return withDatabaseErrorTranslation(() -> jdbc.query("SELECT * FROM pliego.fn_help_article(?)", (rs,row) ->
                new HelpArticle(rs.getString("slug"),rs.getString("category_slug"),rs.getString("title"),
                        rs.getString("summary"),rs.getInt("position"),rs.getString("applicability"),rs.getString("body")),slug)
                .stream().findFirst());
    }
}
