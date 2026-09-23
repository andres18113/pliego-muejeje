package com.pliego.modules.catalog.api;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.format.DateTimeFormatter;
import java.util.List;

import org.springframework.http.MediaType;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.pliego.foundation.web.PageResponse;
import com.pliego.foundation.web.ProblemResponse;
import com.pliego.modules.catalog.application.CatalogEditionDetail;
import com.pliego.modules.catalog.application.CatalogEditionSummary;
import com.pliego.modules.catalog.application.CatalogQuery;
import com.pliego.modules.catalog.application.CatalogSearchPage;
import com.pliego.modules.catalog.application.CatalogService;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

@Validated
@RestController
@RequestMapping(path = "/api/v1/catalog/editions", produces = MediaType.APPLICATION_JSON_VALUE)
@Tag(name = "Catálogo público", description = "Búsqueda pública de ediciones y consulta de su detalle.")
public class CatalogController {

    private static final DateTimeFormatter CONTRACT_DATE = DateTimeFormatter.ISO_LOCAL_DATE;
    private static final String CATEGORY_SLUG = "(?i)[a-z0-9]+(?:-[a-z0-9]+)*";

    private final CatalogService catalogService;

    public CatalogController(CatalogService catalogService) {
        this.catalogService = catalogService;
    }

    @GetMapping
    @Operation(summary = "Buscar ediciones publicables", description = "Filtra y pagina el catálogo público.")
    @ApiResponse(responseCode = "200", description = "Página del catálogo", content = @Content(schema = @Schema(implementation = PageResponse.class)))
    @ApiResponse(responseCode = "400", description = "Filtros inválidos", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    public PageResponse<CatalogEditionSummaryResponse> search(
            @Parameter(description = "Texto parcial del título") @RequestParam(required = false) String title,
            @Parameter(description = "Texto parcial del autor") @RequestParam(required = false) String author,
            @RequestParam(required = false) @Pattern(regexp = "[0-9]{13}") String isbn13,
            @RequestParam(required = false) @Size(max = 140) @Pattern(regexp = CATEGORY_SLUG) String category,
            @RequestParam(required = false) @DecimalMin("0.00") BigDecimal minPrice,
            @RequestParam(required = false) @DecimalMin("0.00") BigDecimal maxPrice,
            @RequestParam(required = false) @Pattern(regexp = "(?i)[a-z]{2,3}") String language,
            @RequestParam(required = false) @Pattern(regexp = "PAPERBACK|HARDCOVER") String format,
            @RequestParam(defaultValue = "TITLE_ASC") @Pattern(regexp = "TITLE_ASC|PRICE_ASC|PRICE_DESC") String sort,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @jakarta.validation.constraints.Max(50) int pageSize) {
        CatalogQuery query = new CatalogQuery(title, author, isbn13, category, minPrice, maxPrice,
                language, format, sort, page, pageSize);
        CatalogSearchPage result = catalogService.search(query);
        List<CatalogEditionSummaryResponse> items = result.items().stream()
                .map(CatalogController::toSummaryResponse).toList();
        return new PageResponse<>(items, page, pageSize, Long.toString(result.totalCount()));
    }

    @GetMapping("/{editionId}")
    @Operation(summary = "Consultar una edición publicable")
    @ApiResponse(responseCode = "200", description = "Detalle de la edición", content = @Content(schema = @Schema(implementation = CatalogEditionDetailResponse.class)))
    @ApiResponse(responseCode = "404", description = "Edición no disponible", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    public CatalogEditionDetailResponse getEdition(@PathVariable @Positive long editionId) {
        return toDetailResponse(catalogService.getPublicEdition(editionId));
    }

    private static CatalogEditionSummaryResponse toSummaryResponse(CatalogEditionSummary edition) {
        return new CatalogEditionSummaryResponse(edition.editionId(), edition.bookId(), edition.title(),
                edition.authors(), edition.publisher(), edition.isbn13(), money(edition.price()),
                edition.coverUrl(), edition.coverLicense(), edition.coverAttribution(), edition.format(),
                edition.language(), edition.available());
    }

    private static CatalogEditionDetailResponse toDetailResponse(CatalogEditionDetail edition) {
        return new CatalogEditionDetailResponse(edition.editionId(), edition.bookId(), edition.title(),
                edition.subtitle(), edition.synopsis(), edition.authors().stream()
                        .map(author -> new CatalogEditionDetailResponse.Author(author.authorId(), author.name(),
                                author.order())).toList(),
                edition.categories().stream()
                        .map(category -> new CatalogEditionDetailResponse.Category(category.categoryId(),
                                category.name(), category.slug(), category.parentCategoryId())).toList(),
                new CatalogEditionDetailResponse.Publisher(edition.publisher().publisherId(),
                        edition.publisher().name()),
                edition.isbn13(), edition.sku(), edition.language(), edition.format(), edition.pageCount(),
                edition.publicationDate() == null ? null : CONTRACT_DATE.format(edition.publicationDate()),
                money(edition.price()), edition.coverUrl(), edition.coverLicense(), edition.coverSourceUrl(),
                edition.coverAttribution(), edition.available());
    }

    private static String money(BigDecimal amount) {
        return amount.setScale(2, RoundingMode.UNNECESSARY).toPlainString();
    }
}
