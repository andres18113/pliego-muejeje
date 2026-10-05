package com.pliego.modules.help.application;
import io.swagger.v3.oas.annotations.media.Schema;
public record HelpCategory(String slug, String title, int position,
        @Schema(allowableValues={"GENERAL","PHYSICAL","EBOOK","AUDIOBOOK"}) String applicability) { }
