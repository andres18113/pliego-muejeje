package com.pliego.modules.help.application;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.pliego.modules.help.gateway.HelpGateway;
@Service
public class HelpService {
    private final HelpGateway gateway;
    public HelpService(HelpGateway gateway) { this.gateway = gateway; }
    @Transactional(readOnly=true) public List<HelpCategory> categories() { return gateway.categories(); }
    @Transactional(readOnly=true) public HelpSearchPage search(String query,String category,String applicability,int page,int pageSize) {
        return gateway.search(query,category,applicability,page,pageSize);
    }
    @Transactional(readOnly=true) public HelpArticle article(String slug) {
        return gateway.article(slug).orElseThrow(HelpArticleNotFoundException::new);
    }
}
