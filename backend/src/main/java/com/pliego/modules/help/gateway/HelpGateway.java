package com.pliego.modules.help.gateway;
import java.util.List;
import java.util.Optional;
import com.pliego.modules.help.application.*;
public interface HelpGateway {
    List<HelpCategory> categories();
    HelpSearchPage search(String query, String category, String applicability, int page, int pageSize);
    Optional<HelpArticle> article(String slug);
}
