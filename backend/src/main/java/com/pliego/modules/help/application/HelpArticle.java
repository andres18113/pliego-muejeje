package com.pliego.modules.help.application;
import io.swagger.v3.oas.annotations.media.Schema;
public record HelpArticle(String slug, String categorySlug, String title, String summary, int position,
        @Schema(allowableValues={"GENERAL","PHYSICAL","EBOOK","AUDIOBOOK"}) String applicability, String body) { }
