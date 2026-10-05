package com.pliego.modules.help.application;
import java.util.List;
public record HelpSearchPage(List<HelpArticleSummary> items, long totalCount) {
    public HelpSearchPage { items = List.copyOf(items); }
}
