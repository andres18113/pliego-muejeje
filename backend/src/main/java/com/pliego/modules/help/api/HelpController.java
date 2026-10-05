package com.pliego.modules.help.api;

import java.util.List;
import org.springframework.http.MediaType;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import jakarta.validation.constraints.*;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import com.pliego.foundation.web.PageResponse;
import com.pliego.modules.help.application.*;

@Validated
@RestController
@RequestMapping(path="/api/v1/help",produces=MediaType.APPLICATION_JSON_VALUE)
@Tag(name="Ayuda pública",description="Solo categorías y artículos publicados; GENERAL se incluye en los filtros de aplicabilidad.")
public class HelpController {
    private final HelpService service;
    public HelpController(HelpService service) { this.service = service; }
    public record HelpCategoryListResponse(List<HelpCategory> items) { }
    @GetMapping("/categories") @Operation(operationId="listHelpCategories",summary="Consultar temas publicados de ayuda")
    public HelpCategoryListResponse categories() { return new HelpCategoryListResponse(service.categories()); }
    @GetMapping("/articles") @Operation(operationId="searchHelpArticles",summary="Buscar artículos publicados de ayuda")
    public PageResponse<HelpArticleSummary> search(
            @RequestParam(name="que",required=false) @Size(max=140,message="La búsqueda no puede superar 140 caracteres.") String query,
            @RequestParam(required=false) @Size(max=140,message="La categoría no puede superar 140 caracteres.")
            @Pattern(regexp="[a-z0-9]+(?:-[a-z0-9]+)*",message="La categoría debe tener un slug válido.") String category,
            @RequestParam(required=false) @Pattern(regexp="GENERAL|PHYSICAL|EBOOK|AUDIOBOOK",message="La aplicabilidad debe ser GENERAL, PHYSICAL, EBOOK o AUDIOBOOK.") String applicability,
            @RequestParam(defaultValue="0") @Min(value=0,message="La página no puede ser negativa.") int page,
            @RequestParam(defaultValue="20") @Min(value=1,message="El tamaño de página debe ser al menos 1.")
            @Max(value=50,message="El tamaño de página no puede superar 50.") int pageSize) {
        HelpSearchPage result = service.search(query,category,applicability,page,pageSize);
        return new PageResponse<>(result.items(),page,pageSize,Long.toString(result.totalCount()));
    }
    @GetMapping("/articles/{slug}") @Operation(operationId="getHelpArticle",summary="Consultar un artículo publicado de ayuda")
    public HelpArticle article(@PathVariable @Size(max=140,message="El slug no puede superar 140 caracteres.")
            @Pattern(regexp="[a-z0-9]+(?:-[a-z0-9]+)*",message="El artículo debe tener un slug válido.") String slug) {
        return service.article(slug);
    }
}
